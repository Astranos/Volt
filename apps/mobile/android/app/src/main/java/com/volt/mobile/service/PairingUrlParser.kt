package com.volt.mobile.service

import com.volt.mobile.model.CaptureMode
import com.volt.mobile.model.PairingSession
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

data class ParsedPairingUrl(val session: PairingSession?, val mode: CaptureMode?)

object PairingUrlParser {
    fun parse(url: String): ParsedPairingUrl = parse(URI.create(url))
    fun parse(url: URI): ParsedPairingUrl {
        val query = url.rawQuery.orEmpty().split('&').filter { it.isNotEmpty() }.mapNotNull {
            val pieces = it.split('=', limit = 2); if (pieces.size != 2) null else decode(pieces[0]) to decode(pieces[1])
        }.toMap()
        val path = pathParts(url)
        val mode = CaptureMode.fromRaw(query["mode"]) ?: (listOfNotNull(url.host) + path).firstNotNullOfOrNull(CaptureMode::fromRaw)
        val session = PairingSession(
            token = query["token"] ?: query["joinToken"] ?: joinToken(url),
            sessionId = query["sessionId"] ?: query["session"], attemptId = query["joinAttemptId"], offer = query["offer"],
            answerUrl = query["answerUrl"]?.takeIf(::validUri), label = query["label"],
            signalUrl = query["signalUrl"]?.takeIf(::validUri)?.let { signalBaseUrl(URI.create(it))?.toString() } ?: signalBaseUrl(url)?.toString(),
            cloudUrl = query["cloudUrl"]?.takeIf(::validUri), guestCloudGrant = query["guestCloudGrant"],
            guestCloudExpiresAt = query["guestCloudExpiresAt"]?.toDoubleOrNull()?.toLong(), sourceUrl = url.toString(),
        )
        return ParsedPairingUrl(session.takeIf { it.isPresent }, mode)
    }
    fun pairingUrlIn(text: String): URI? = text.split(Regex("\\s+")).asSequence().mapNotNull { raw ->
        val value = raw.trim().trim('"', '\'', '<', '>', '[', ']', '(', ')', '{', '}')
        runCatching { URI.create(value) }.getOrNull()
    }.firstOrNull { runCatching { parse(it).session != null }.getOrDefault(false) }
    fun joinToken(url: URI): String? { val p = pathParts(url); return p.getOrNull(3)?.takeIf { p.take(3) == listOf("api", "signal", "join-token") } }
    fun signalBaseUrl(url: URI): URI? { val p = pathParts(url); if (p.take(2) != listOf("api", "signal")) return null; return URI(url.scheme, null, url.host, url.port, "/api/signal", null, null) }
    private fun pathParts(uri: URI) = uri.path.orEmpty().split('/').filter(String::isNotEmpty)
    private fun decode(value: String) = URLDecoder.decode(value, StandardCharsets.UTF_8.name())
    private fun validUri(value: String) = runCatching { URI.create(value).isAbsolute }.getOrDefault(false)
}
