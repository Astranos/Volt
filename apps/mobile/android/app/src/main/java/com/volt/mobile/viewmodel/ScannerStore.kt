package com.volt.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.volt.mobile.model.*
import com.volt.mobile.service.*
import java.io.File
import java.net.URI
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

enum class ConnectionState { Disconnected, Connecting, Connected, Failed }

class ScannerStore(application: Application) : AndroidViewModel(application) {
    @Serializable private data class HistoryItem(val id: String, val kind: String, val source: String, val value: String, val format: String, val capturedAt: Long, val batchId: String?, val deliveryState: String)
    private val historyFile = File(application.filesDir, "volt_history.json")
    private val credentials = DeviceCredentialStore(application)
    private val api = MobileCloudApiClient()
    private val signaling = ScannerSignalingClient()
    private val pairingSecrets = PairingSecretStore(application)
    private val contributorId = ScannerProtocol.makeContributorId()
    private var rtc: WebRtcPairingClient? = null
    private var activeSignalUrl: URI = ScannerProtocol.signalUrl
    private val registeredPairingIds = mutableSetOf<String>()
    private var lastBarcodeValue: String? = null
    private var lastBarcodeAt = 0L
    private val _results = MutableStateFlow(loadHistory()); val results: StateFlow<List<ScanResult>> = _results.asStateFlow()
    private val _activeMode = MutableStateFlow(CaptureMode.BARCODE); val activeMode = _activeMode.asStateFlow()
    private val _connectionState = MutableStateFlow(ConnectionState.Disconnected); val connectionState = _connectionState.asStateFlow()
    private val _pairingLabel = MutableStateFlow<String?>(null); val pairingLabel = _pairingLabel.asStateFlow()
    private val _computers = MutableStateFlow<List<CloudComputer>>(emptyList()); val computers = _computers.asStateFlow()
    private val _cursorTargetDeviceId = MutableStateFlow<String?>(null); val cursorTargetDeviceId = _cursorTargetDeviceId.asStateFlow()
    private val _errorMessage = MutableStateFlow<String?>(null); val errorMessage = _errorMessage.asStateFlow()
    private val _isSyncing = MutableStateFlow(false); val isSyncing = _isSyncing.asStateFlow()
    private val outbox = CaptureOutbox(application, api, credentials) { id, state -> viewModelScope.launch(Dispatchers.Main.immediate) { updateState(id, state) } }

    fun setMode(mode: CaptureMode) { _activeMode.value = mode }
    fun onBarcode(value: String, format: String) {
        val normalized = normalizeBarcode(value, format)
        if (normalized.first.isEmpty()) return
        val now = System.currentTimeMillis()
        if (normalized.first == lastBarcodeValue && now - lastBarcodeAt < 1_500L) return
        lastBarcodeValue = normalized.first
        lastBarcodeAt = now
        add(ScanResult(kind = ScanResult.Kind.BARCODE, value = normalized.first, format = normalized.second))
    }
    fun onOcrText(text: String) = add(ScanResult(kind = ScanResult.Kind.TEXT, value = text, format = "plain-text"))
    fun capturePhoto(jpegBytes: ByteArray, width: Int, height: Int) = add(ScanResult(kind = ScanResult.Kind.PHOTO, value = "Photo", format = "image/jpeg", imageBytes = jpegBytes), width, height, sendToChrome = false)
    fun connect(session: PairingSession) { disconnect(); _connectionState.value = ConnectionState.Connecting; _pairingLabel.value = session.label; viewModelScope.launch { runCatching {
        var signal = session.signalUrl?.let(URI::create) ?: ScannerProtocol.signalUrl
        val offer: String
        val answerUrl: URI
        val chromeSessionId: String
        if (session.offer != null && session.answerUrl != null) {
            offer = session.offer
            answerUrl = URI.create(session.answerUrl)
            chromeSessionId = session.sessionId ?: session.token ?: throw ScannerPairingError.MissingPairingUrl
        } else {
            var token = session.token ?: throw ScannerPairingError.MissingPairingUrl
            val found = try {
                val resolved = signaling.createJoinAttemptResolvingSignalUrl(token, contributorId, signal, allowFallback = true)
                signal = resolved.second
                signaling.pollOffer(token, resolved.first)
            } catch (directError: Exception) {
                val pairing = pairingSecrets.load() ?: throw directError
                val reconnect = signaling.requestReconnect(pairing.pairingId, pairing.pairingSecret, ScannerProtocol.reconnectSignalUrls)
                token = reconnect.token
                signal = reconnect.sourceUrl
                val attempt = signaling.createJoinAttempt(token, contributorId, signal)
                signaling.pollOffer(token, attempt)
            }
            offer = found.offer
            answerUrl = found.answerUrl
            chromeSessionId = found.sessionId ?: token
        }
        activeSignalUrl = signal
        val client = WebRtcPairingClient(getApplication(), contributorId, chromeSessionId, ::handleRtcState, ::handleMessage); rtc = client
        val ice = runCatching { signaling.fetchIceServerConfiguration(signal) }.getOrElse { ScannerProtocol.IceServerConfiguration(listOf(ScannerProtocol.IceServer(listOf("stun:stun.l.google.com:19302"), null, null), ScannerProtocol.IceServer(listOf("stun:stun1.l.google.com:19302"), null, null))) }
        signaling.postAnswer(client.createAnswer(offer, ice), answerUrl)
    }.onFailure { _connectionState.value = ConnectionState.Failed; _errorMessage.value = it.message } } }
    fun disconnect() { rtc?.close(); rtc = null; _connectionState.value = ConnectionState.Disconnected; _pairingLabel.value = null }
    fun setCursorTarget(deviceId: String?) { _cursorTargetDeviceId.value = deviceId; val credential = credentials.load() ?: return; viewModelScope.launch { runCatching { api.setCursorTarget(SetCursorTargetRequest(credential.deviceId, credential.value, deviceId)) }.onFailure { _errorMessage.value = it.message } } }
    fun handleIncomingUrl(url: String): Boolean { val parsed = runCatching { PairingUrlParser.parse(url) }.getOrNull() ?: return false; parsed.mode?.let(::setMode); parsed.session?.let(::connect); return parsed.mode != null || parsed.session != null }
    fun dismissError() { _errorMessage.value = null }
    fun refreshAfterBootstrap() { viewModelScope.launch { refreshComputers() } }
    fun retryPending() { _isSyncing.value = true; outbox.retryPending(); viewModelScope.launch { delay(500); _isSyncing.value = false; refreshComputers() } }
    private fun add(result: ScanResult, width: Int? = null, height: Int? = null, sendToChrome: Boolean = true) { val connected = sendToChrome && connectionState.value == ConnectionState.Connected; result.deliveryState = if (connected) ScanResult.DeliveryState.SENDING else ScanResult.DeliveryState.SAVED; _results.value = (listOf(result) + _results.value).take(200); saveHistory(); viewModelScope.launch { outbox.enqueue(result, width, height) }; if (connected) { val message = ScannerProtocol.encode(ScannerProtocol.captureResult(result.id.toString(), result.kind.rawValue, result.value, result.format, result.capturedAt, _cursorTargetDeviceId.value != null, contributorId)); if (rtc?.send(message) != true) updateState(result.id, ScanResult.DeliveryState.FAILED) } }
    private fun handleMessage(raw: String) { ScannerProtocol.parseSessionReady(raw)?.let { ready ->
        ready.activeMode?.let { _activeMode.value = it }
        _pairingLabel.value = ready.peer?.deviceLabel ?: _pairingLabel.value
        ready.pairing?.let { pairing ->
            pairingSecrets.save(pairing)
            if (registeredPairingIds.add(pairing.pairingId)) viewModelScope.launch {
                val registered = signaling.registerPairingCandidates(pairing.pairingId, pairing.pairingSecret, pairing.browserSessionId, pairing.displayName ?: "Chrome session", contributorId, listOf(activeSignalUrl) + ScannerProtocol.fallbackSignalUrls)
                if (!registered) _errorMessage.value = "Volt could not save this Chrome pairing for reconnect."
            }
        }
        return
    }; ScannerProtocol.parseResultReceived(raw)?.let { updateState(UUID.fromString(it.resultId), ScanResult.DeliveryState.SENT); return }; ScannerProtocol.parseProtocolError(raw)?.let { _errorMessage.value = it.detail ?: it.code; val id = runCatching { Json.parseToJsonElement(raw).jsonObject["resultId"]?.jsonPrimitive?.content }.getOrNull(); id?.let { value -> runCatching { updateState(UUID.fromString(value), ScanResult.DeliveryState.FAILED) } }; return } }
    private fun handleRtcState(state: WebRtcPairingClient.State) { _connectionState.value = when (state) { WebRtcPairingClient.State.Connected -> ConnectionState.Connected; WebRtcPairingClient.State.Closed -> ConnectionState.Disconnected; WebRtcPairingClient.State.Failed -> ConnectionState.Failed } }
    private fun updateState(id: UUID, state: ScanResult.DeliveryState) { _results.value = _results.value.map { if (it.id == id) it.copy(deliveryState = state) else it }; saveHistory() }
    private suspend fun refreshComputers() { val c = credentials.load() ?: return; runCatching { api.listComputers(ListCloudComputersRequest(c.deviceId, c.value)) }.onSuccess { _computers.value = it.computers; _cursorTargetDeviceId.value = it.cursorTargetDeviceId } }
    private fun normalizeBarcode(value: String, format: String): Pair<String, String> {
        val trimmed = value.trim()
        val rawFormat = format.lowercase()
        val normalizedFormat = when {
            "ean13" in rawFormat || "ean-13" in rawFormat -> "ean13"
            "upce" in rawFormat || "upc-e" in rawFormat -> "upc_e"
            "qr" in rawFormat -> "qr"
            else -> rawFormat.replace("org.iso.", "")
        }
        return if (normalizedFormat == "ean13" && trimmed.length == 13 && trimmed.startsWith('0') && trimmed.all(Char::isDigit)) trimmed.drop(1) to "upc_a" else trimmed to normalizedFormat
    }
    private fun loadHistory(): List<ScanResult> = runCatching { MobileCloudApiClient.json.decodeFromString<List<HistoryItem>>(historyFile.readText()).mapNotNull { h -> val kind = ScanResult.Kind.fromRaw(h.kind) ?: return@mapNotNull null; ScanResult(UUID.fromString(h.id), kind, ScanResult.Source.entries.firstOrNull { it.rawValue == h.source } ?: ScanResult.Source.CAPTURE, h.value, h.format, h.capturedAt, h.batchId, ScanResult.DeliveryState.entries.firstOrNull { it.rawValue == h.deliveryState } ?: ScanResult.DeliveryState.SAVED) }.sortedByDescending { it.capturedAt }.take(200) }.getOrDefault(emptyList())
    private fun saveHistory() { runCatching { val items = _results.value.take(200).map { HistoryItem(it.id.toString(), it.kind.rawValue, it.source.rawValue, it.value, it.format, it.capturedAt, it.batchId, it.deliveryState.rawValue) }; val tmp = File(historyFile.parentFile, "${historyFile.name}.tmp"); tmp.writeText(MobileCloudApiClient.json.encodeToString(items)); if (!tmp.renameTo(historyFile)) { historyFile.writeText(tmp.readText()); tmp.delete() } } }
    override fun onCleared() { disconnect(); outbox.close(); super.onCleared() }
}
