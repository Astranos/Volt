package com.volt.mobile.service

import android.os.Build
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class ScannerSignalingClient(private val client: OkHttpClient = OkHttpClient()) {
    data class ReconnectJoinWindow(val token: String, val sessionId: String?, val sourceUrl: URI)
    data class Offer(val offer: String, val answerUrl: URI, val sessionId: String?)
    private data class StatusRequest(val url: URI)
    @Serializable private data class RegisterBody(val pairingId: String, val pairingSecret: String, val browserSessionId: String, val displayName: String, val phoneDeviceId: String, val phoneLabel: String)
    @Serializable private data class JoinBody(val contributorId: String, val deviceLabel: String = "Android", val protocolVersion: String = "1.0.0", val capabilities: List<String> = ScannerProtocol.supportedCapabilities)
    @Serializable private data class AnswerBody(val answer: String)
    @Serializable private data class ReconnectBody(val pairingSecret: String)

    suspend fun fetchIceServerConfiguration(signalUrl: URI = ScannerProtocol.signalUrl): ScannerProtocol.IceServerConfiguration =
        ScannerProtocol.json.decodeFromString(request(uri(signalUrl, "ice-servers")).body)

    suspend fun registerPairing(pairing: ScannerProtocol.Pairing, phoneDeviceId: String, signalUrl: URI = ScannerProtocol.signalUrl) =
        registerPairing(pairing.pairingId, pairing.pairingSecret, pairing.browserSessionId, pairing.displayName ?: "Chrome session", phoneDeviceId, signalUrl)

    suspend fun registerPairing(pairingId: String, pairingSecret: String, browserSessionId: String, displayName: String, phoneDeviceId: String, signalUrl: URI = ScannerProtocol.signalUrl, retries: Int = 2, timeoutSeconds: Long = 8) {
        val body = ScannerProtocol.json.encodeToString(RegisterBody.serializer(), RegisterBody(pairingId, pairingSecret, browserSessionId, displayName, phoneDeviceId, Build.MODEL))
        request(uri(signalUrl, "pairings"), "POST", body, retries = retries, timeoutSeconds = timeoutSeconds)
    }
    suspend fun registerPairingCandidates(pairingId: String, pairingSecret: String, browserSessionId: String, displayName: String, phoneDeviceId: String, signalUrls: List<URI>): Boolean = coroutineScope {
        signalUrls.map { url -> async { runCatching { registerPairing(pairingId, pairingSecret, browserSessionId, displayName, phoneDeviceId, url, 0, 3) }.isSuccess } }.awaitAll().any { it }
    }
    suspend fun requestReconnect(pairingId: String, pairingSecret: String, signalUrls: List<URI> = listOf(ScannerProtocol.signalUrl)): ReconnectJoinWindow = coroutineScope {
        val probe = signalUrls.size > 1
        val statuses = signalUrls.map { url -> async { runCatching {
            val response = request(uri(url, "pairings", pairingId, "reconnect"), "POST", ScannerProtocol.json.encodeToString(ReconnectBody.serializer(), ReconnectBody(pairingSecret)), mapOf("X-Volt-Pairing-Secret" to pairingSecret), if (probe) 0 else 2, if (probe) 3 else 8)
            val root = ScannerProtocol.json.parseToJsonElement(response.body).jsonObject; val obj = root["request"]?.jsonObject ?: root
            val id = obj["id"]?.jsonPrimitive?.content ?: throw ScannerPairingError.RequestFailed
            StatusRequest(uri(url, "pairings", pairingId, "reconnect", id))
        }.getOrNull() } }.awaitAll().filterNotNull()
        if (statuses.isEmpty()) throw ScannerPairingError.RequestFailed
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ScannerProtocol.reconnectRequestTtlMs)
        var last: ScannerPairingError = ScannerPairingError.ChromeTimedOut
        while (System.nanoTime() < deadline) {
            statuses.forEach { status -> runCatching { request(status.url, headers = mapOf("X-Volt-Pairing-Secret" to pairingSecret), retries = 0, timeoutSeconds = 3) }.onSuccess { response ->
                val root = ScannerProtocol.json.parseToJsonElement(response.body).jsonObject; val obj = root["request"]?.jsonObject ?: root
                if (obj["status"]?.jsonPrimitive?.content == "join_window_ready") return@coroutineScope ReconnectJoinWindow(obj.getValue("joinToken").jsonPrimitive.content, obj["sessionId"]?.jsonPrimitive?.contentOrNull, URI.create(status.url.toString().substringBefore("/pairings/")))
                if (obj["status"]?.jsonPrimitive?.content == "expired") last = ScannerPairingError.JoinTokenExpired
            }.onFailure { if (it is ScannerPairingError) last = it } }
            delay(ScannerProtocol.joinAttemptPollIntervalMs)
        }
        throw last
    }
    suspend fun createJoinAttempt(token: String, contributorId: String, signalUrl: URI = ScannerProtocol.signalUrl): ScannerProtocol.JoinAttempt {
        val encoded = URLEncoder.encode(token, StandardCharsets.UTF_8).replace("+", "%20")
        val base = uri(signalUrl, "join-token", encoded, "attempt")
        val response = request(base, "POST", ScannerProtocol.json.encodeToString(JoinBody.serializer(), JoinBody(contributorId)))
        val root = ScannerProtocol.json.parseToJsonElement(response.body).jsonObject; val obj = root["attempt"]?.jsonObject ?: root
        val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: obj["attemptId"]?.jsonPrimitive?.contentOrNull ?: throw ScannerPairingError.RequestFailed
        return ScannerProtocol.JoinAttempt(id, uri(base, id, "offer"), uri(base, id, "answer"))
    }
    suspend fun createJoinAttemptResolvingSignalUrl(token: String, contributorId: String, preferredSignalUrl: URI, allowFallback: Boolean): Pair<ScannerProtocol.JoinAttempt, URI> {
        val candidates = buildList {
            add(preferredSignalUrl)
            if (allowFallback) ScannerProtocol.fallbackSignalUrls.filterNotTo(this) { it == preferredSignalUrl }
        }
        var lastError: ScannerPairingError? = null
        for (candidate in candidates) {
            try {
                return createJoinAttempt(token, contributorId, candidate) to candidate
            } catch (error: ScannerPairingError.SignalRejected) {
                if (!allowFallback || error.statusCode != 404 || error.detail != "Join token not found") throw error
                lastError = error
            }
        }
        throw lastError ?: ScannerPairingError.RequestFailed
    }
    suspend fun pollOffer(token: String, attempt: ScannerProtocol.JoinAttempt): Offer {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ScannerProtocol.joinAttemptTtlMs)
        while (System.nanoTime() < deadline) {
            val obj = ScannerProtocol.json.parseToJsonElement(request(attempt.pollUrl).body).jsonObject
            val offer = obj["offer"]?.jsonPrimitive?.contentOrNull ?: obj["sdp"]?.jsonPrimitive?.contentOrNull
            if (offer != null) return Offer(trimPayload(offer), attempt.answerUrl, obj["sessionId"]?.jsonPrimitive?.contentOrNull ?: attempt.sessionId ?: token)
            delay(ScannerProtocol.joinAttemptPollIntervalMs)
        }
        throw ScannerPairingError.ChromeTimedOut
    }
    suspend fun postAnswer(answer: ScannerProtocol.SessionDescription, answerUrl: URI) {
        val encoded = ScannerProtocol.json.encodeToString(ScannerProtocol.SessionDescription.serializer(), answer)
        request(answerUrl, "POST", ScannerProtocol.json.encodeToString(AnswerBody.serializer(), AnswerBody(encoded)))
    }
    private data class SignalResponse(val body: String)
    private suspend fun request(url: URI, method: String = "GET", body: String? = null, headers: Map<String, String> = emptyMap(), retries: Int = 2, timeoutSeconds: Long = 8): SignalResponse = withContext(Dispatchers.IO) {
        val timed = client.newBuilder().callTimeout(timeoutSeconds, TimeUnit.SECONDS).build()
        repeat(retries + 1) { attempt ->
            try {
                val builder = Request.Builder().url(url.toString()).header("Accept", "application/json"); headers.forEach(builder::header)
                if (method == "POST") builder.header("Content-Type", "application/json").post(body.orEmpty().toRequestBody("application/json".toMediaType()))
                timed.newCall(builder.build()).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    if (response.code == 410) throw ScannerPairingError.JoinTokenExpired
                    if (response.code in 200..299) return@withContext SignalResponse(text)
                    if (attempt < retries && (response.code == 408 || response.code == 429 || response.code >= 500)) { delay(250L shl attempt); return@repeat }
                    val detail = runCatching { ScannerProtocol.json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
                    throw ScannerPairingError.SignalRejected(response.code, detail)
                }
            } catch (e: ScannerPairingError) { throw e } catch (e: Exception) { if (attempt == retries) throw ScannerPairingError.RequestFailed; delay(250L shl attempt) }
        }
        throw ScannerPairingError.RequestFailed
    }
    private fun uri(base: URI, vararg segments: String) = URI.create(base.toString().trimEnd('/') + segments.joinToString("/", prefix = "/") { it.trim('/') })
    private fun trimPayload(value: String): String { val text = value.trim(); return if (text.startsWith("{")) runCatching { ScannerProtocol.encodePairingPayload(ScannerProtocol.json.decodeFromString(text)) }.getOrDefault(text) else text }
}
