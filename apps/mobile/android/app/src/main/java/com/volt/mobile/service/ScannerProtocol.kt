package com.volt.mobile.service

import com.volt.mobile.AppConfiguration
import com.volt.mobile.BuildConfig
import com.volt.mobile.model.CaptureMode
import java.net.URI
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.*

object ScannerProtocol {
    val developmentSignalUrl: URI = URI.create("https://adorable-hornet-19.convex.site/api/signal")
    val productionSignalUrl: URI = URI.create("https://sincere-trout-414.convex.site/api/signal")
    val signalUrl: URI = URI.create(AppConfiguration.convexSiteUrl.toString().trimEnd('/') + "/api/signal")
    val fallbackSignalUrls: List<URI> = if (BuildConfig.DEBUG) listOf(productionSignalUrl) else emptyList()
    val reconnectSignalUrls = listOf(signalUrl) + fallbackSignalUrls
    const val controlChannel = "scanner-control"
    const val photoTransferChannel = "photo-transfer"
    const val chunkSize = 65_536
    const val joinAttemptTtlMs = 32_000L
    const val reconnectRequestTtlMs = 95_000L
    const val joinAttemptPollIntervalMs = 300L
    const val iceGatheringTimeoutMs = 2_000L
    const val photoReceiptTimeoutMs = 20_000L
    const val signalRequestTimeoutSeconds = 8L
    const val reconnectCandidateRequestTimeoutSeconds = 3L
    val supportedCapabilities = listOf("ocr", "barcode", "photo")
    val supportedPeerPlatforms = listOf("ios", "android", "chrome_extension", "web", "unknown")
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

    enum class MessageType(val rawValue: String) { HELLO("hello"), CAPTURE_RESULT("capture_result"), DICTATION("dictation"), MODE_CHANGED("mode_changed"), SESSION_READY("session_ready"), RESULT_RECEIVED("result_received"), PROTOCOL_ERROR("protocol_error"), PHOTO_START("photo_start"), PHOTO_CHUNK("photo_chunk"), PHOTO_COMPLETE("photo_complete"), PHOTO_CHUNK_ACK("photo_chunk_ack"), PHOTO_RECEIVED("photo_received"), PHOTO_REJECTED("photo_rejected"), PHOTO_CANCEL("photo_cancel"), SESSION_CLOSED("session_closed") }
    @Serializable data class ProtocolVersion(val major: Int, val minor: Int, val patch: Int? = null)
    @Serializable data class Peer(val protocolVersion: ProtocolVersion, val appVersion: String? = null, val platform: String, val capabilities: List<String>, val contributorId: String? = null, val deviceLabel: String? = null, val chromeSessionId: String)
    @Serializable data class SessionDescription(val type: String, val sdp: String)
    @Serializable data class IceServerConfiguration(val iceServers: List<IceServer>, val ttlSeconds: Int? = null, val expiresAt: String? = null) { init { require(iceServers.isNotEmpty()) } }
    @Serializable data class IceServer(@Serializable(with = StringListSerializer::class) val urls: List<String>, val username: String? = null, val credential: String? = null) { init { require(urls.isNotEmpty() && urls.none { it.isBlank() }) } }
    data class JoinAttempt(val attemptId: String, val pollUrl: URI, val answerUrl: URI, val sessionId: String? = null)
    @Serializable data class SessionReady(val peer: SessionPeer? = null, @Serializable(with = CaptureModeSerializer::class) val activeMode: CaptureMode? = null, val pairing: Pairing? = null, val cursorTarget: CursorTarget? = null)
    @Serializable data class SessionPeer(val chromeSessionId: String? = null, val deviceLabel: String? = null, val platform: String? = null)
    @Serializable data class Pairing(val pairingId: String, val pairingSecret: String, val browserSessionId: String, val displayName: String? = null)
    @Serializable data class CursorTarget(val tabTitle: String? = null, val url: String? = null, val label: String? = null, val hasCursorTarget: Boolean? = null)
    @Serializable data class ResultReceived(val resultId: String, val savedToResults: Boolean, val insertedIntoCursor: Boolean? = null, val cursorTarget: CursorTarget? = null)
    @Serializable data class ProtocolError(val code: String, val detail: String? = null, val receivedType: String? = null)
    @Serializable data class PhotoChunkAck(val photoId: String, val chunkIndex: Int, val totalChunks: Int? = null)
    @Serializable data class PhotoReceived(val photoId: String, val photoBatchId: String, val storedAt: String, val size: Int)
    @Serializable data class PhotoRejected(val photoId: String, val reason: String, val retryable: Boolean, val detail: String? = null)
    data class PhotoPayload(val id: String, val batchId: String, val filename: String, val data: ByteArray, val width: Int, val height: Int, val capturedAtMs: Long)

    fun makeContributorId() = "volt-photo-${UUID.randomUUID().toString().replace("-", "").take(24)}"
    fun makeMessageId(prefix: String) = "$prefix-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8).lowercase()}"
    fun baseMessage(type: MessageType, prefix: String): MutableMap<String, JsonElement> = mutableMapOf("type" to JsonPrimitive(type.rawValue), "messageId" to JsonPrimitive(makeMessageId(prefix)), "sentAt" to JsonPrimitive(dateString(System.currentTimeMillis())))
    fun captureResult(id: String, kind: String, value: String, format: String, capturedAtMs: Long, insertIntoCursor: Boolean, contributorId: String) = baseMessage(MessageType.CAPTURE_RESULT, "capture").apply { put("resultId", JsonPrimitive(id)); put("resultKind", JsonPrimitive(kind)); put("value", JsonPrimitive(value)); put("format", JsonPrimitive(format)); put("capturedAt", JsonPrimitive(dateString(capturedAtMs))); put("insertIntoCursor", JsonPrimitive(insertIntoCursor)); put("contributorId", JsonPrimitive(contributorId)) }
    fun photoStart(payload: PhotoPayload, contributorId: String, totalChunks: Int) = baseMessage(MessageType.PHOTO_START, "photo").apply { put("photoId", JsonPrimitive(payload.id)); put("photoBatchId", JsonPrimitive(payload.batchId)); put("contributorId", JsonPrimitive(contributorId)); put("filename", JsonPrimitive(payload.filename)); put("mimeType", JsonPrimitive("image/jpeg")); put("size", JsonPrimitive(payload.data.size)); put("width", JsonPrimitive(payload.width)); put("height", JsonPrimitive(payload.height)); put("capturedAt", JsonPrimitive(dateString(payload.capturedAtMs))); put("chunkSize", JsonPrimitive(chunkSize)); put("totalChunks", JsonPrimitive(totalChunks)) }
    fun photoChunk(photoId: String, index: Int, totalChunks: Int, base64: String) = baseMessage(MessageType.PHOTO_CHUNK, "photo").apply { put("photoId", JsonPrimitive(photoId)); put("chunkIndex", JsonPrimitive(index)); put("totalChunks", JsonPrimitive(totalChunks)); put("data", JsonPrimitive(base64)) }
    fun photoComplete(photoId: String, totalChunks: Int) = baseMessage(MessageType.PHOTO_COMPLETE, "photo").apply { put("photoId", JsonPrimitive(photoId)); put("totalChunks", JsonPrimitive(totalChunks)) }
    fun hello(contributorId: String, chromeSessionId: String, deviceLabel: String = "Android") =
        baseMessage(MessageType.HELLO, "hello").apply {
            put(
                "peer",
                json.encodeToJsonElement(
                    Peer(
                        protocolVersion = ProtocolVersion(1, 0, 0),
                        appVersion = BuildConfig.VERSION_NAME,
                        platform = "android",
                        capabilities = supportedCapabilities,
                        contributorId = contributorId,
                        deviceLabel = deviceLabel,
                        chromeSessionId = chromeSessionId,
                    ),
                ),
            )
        }
    fun encode(message: Map<String, JsonElement>) = JsonObject(message).toString()
    fun encodePairingPayload(value: SessionDescription) = Base64.getUrlEncoder().withoutPadding().encodeToString(json.encodeToString(SessionDescription.serializer(), value).toByteArray())
    fun decodePairingPayload(value: String) = runCatching { json.decodeFromString(SessionDescription.serializer(), String(Base64.getUrlDecoder().decode(value))) }.getOrElse { throw ScannerPairingError.InvalidPairingPayload }
    fun parseSessionReady(raw: String) = parse<SessionReady>(raw, MessageType.SESSION_READY)
    fun parseResultReceived(raw: String) = parse<ResultReceived>(raw, MessageType.RESULT_RECEIVED)
    fun parseProtocolError(raw: String) = parse<ProtocolError>(raw, MessageType.PROTOCOL_ERROR)
    fun parsePhotoChunkAck(raw: String) = parse<PhotoChunkAck>(raw, MessageType.PHOTO_CHUNK_ACK)
    fun parsePhotoReceived(raw: String) = parse<PhotoReceived>(raw, MessageType.PHOTO_RECEIVED)
    fun parsePhotoRejected(raw: String) = parse<PhotoRejected>(raw, MessageType.PHOTO_REJECTED)
    private inline fun <reified T> parse(raw: String, type: MessageType): T? = runCatching { val element = json.parseToJsonElement(raw).jsonObject; if (element["type"]?.jsonPrimitive?.content != type.rawValue) null else json.decodeFromJsonElement<T>(element) }.getOrNull()
    private val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    private fun dateString(ms: Long) = formatter.format(Instant.ofEpochMilli(ms))
}

object StringListSerializer : kotlinx.serialization.KSerializer<List<String>> {
    override val descriptor = kotlinx.serialization.builtins.ListSerializer(String.serializer()).descriptor
    override fun serialize(encoder: kotlinx.serialization.encoding.Encoder, value: List<String>) = encoder.encodeSerializableValue(kotlinx.serialization.builtins.ListSerializer(String.serializer()), value)
    override fun deserialize(decoder: kotlinx.serialization.encoding.Decoder): List<String> { val input = decoder as? kotlinx.serialization.json.JsonDecoder ?: error("JSON required"); return when (val e = input.decodeJsonElement()) { is JsonArray -> e.map { it.jsonPrimitive.content }; is JsonPrimitive -> listOf(e.content); else -> error("Invalid ICE urls") } }
}

object CaptureModeSerializer : kotlinx.serialization.KSerializer<CaptureMode> {
    override val descriptor = kotlinx.serialization.descriptors.PrimitiveSerialDescriptor("CaptureMode", kotlinx.serialization.descriptors.PrimitiveKind.STRING)
    override fun serialize(encoder: kotlinx.serialization.encoding.Encoder, value: CaptureMode) = encoder.encodeString(value.rawValue)
    override fun deserialize(decoder: kotlinx.serialization.encoding.Decoder): CaptureMode = CaptureMode.fromRaw(decoder.decodeString()) ?: throw kotlinx.serialization.SerializationException("Unknown capture mode")
}

sealed class ScannerPairingError(message: String) : Exception(message) {
    data object InvalidPairingPayload : ScannerPairingError("The pairing QR is not valid."); data object InvalidMessage : ScannerPairingError("Could not encode scanner protocol message."); data object MissingPairingUrl : ScannerPairingError("Scan the Chrome pairing QR again."); data object MissingOffer : ScannerPairingError("Chrome did not publish a WebRTC offer."); data object MissingAnswer : ScannerPairingError("Could not create a WebRTC answer."); data object CouldNotCreatePeer : ScannerPairingError("Could not create a WebRTC connection."); data object ChannelNotOpen : ScannerPairingError("Pair with Chrome before sending."); data object ChromeTimedOut : ScannerPairingError("Chrome did not respond in time. Reopen the QR and scan again."); data object JoinTokenExpired : ScannerPairingError("This Chrome pairing session expired. Scan the QR again."); data object RequestFailed : ScannerPairingError("The scanner signaling service did not accept the request."); data class SignalRejected(val statusCode: Int, val detail: String?) : ScannerPairingError(if (detail.isNullOrEmpty()) "The scanner signaling service rejected the request ($statusCode)." else "The scanner signaling service rejected the request ($statusCode): $detail"); data class PhotoRejectedError(val reason: String) : ScannerPairingError("Chrome rejected the photo: $reason"); data object PhotoDeliveryInterrupted : ScannerPairingError("Photo delivery was interrupted."); data object PhotoDeliveryTimedOut : ScannerPairingError("Chrome did not confirm photo delivery in time.")
}
