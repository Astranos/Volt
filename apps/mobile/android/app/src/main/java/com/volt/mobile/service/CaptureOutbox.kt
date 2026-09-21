package com.volt.mobile.service

import android.content.Context
import com.volt.mobile.model.*
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlin.math.min
import kotlin.coroutines.coroutineContext
import kotlin.random.Random
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

class CaptureOutbox(
    context: Context,
    private val api: MobileCloudApi = MobileCloudApiClient(),
    private val credentials: DeviceCredentialStore = DeviceCredentialStore(context),
    private val onDeliveryState: (UUID, ScanResult.DeliveryState) -> Unit = { _, _ -> },
) : AutoCloseable {
    @Serializable private data class Record(val id: String, val batchId: String, val kind: String, val value: String, val format: String, val capturedAt: Long, val photoBase64: String? = null, val width: Int? = null, val height: Int? = null, val attempts: Int = 0, val retryAt: Long = 0)
    @Serializable private data class Manifest(val records: List<Record> = emptyList())
    private val file = File(context.filesDir, "volt_outbox.json")
    private val mutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var records = load().toMutableList()
    private var worker: Job? = null
    init { if (records.isNotEmpty()) startWorker() }

    suspend fun enqueue(result: ScanResult, width: Int? = null, height: Int? = null) = mutex.withLock {
        val record = Record(result.id.toString(), result.batchId ?: result.id.toString().lowercase(), result.kind.rawValue, result.value, result.format, result.capturedAt, result.imageBytes?.let { java.util.Base64.getEncoder().encodeToString(it) }, width, height)
        records.removeAll { it.id == record.id }; records.add(record); save(); startWorker()
    }
    fun retryPending() { scope.launch { mutex.withLock { records = records.map { it.copy(retryAt = 0) }.toMutableList(); save() }; startWorker() } }
    private fun startWorker() { if (worker?.isActive != true) worker = scope.launch { drain() } }
    private suspend fun drain() {
        while (coroutineContext.isActive) {
            val batch = mutex.withLock {
                val now = System.currentTimeMillis()
                val next = records.minByOrNull { it.retryAt }
                if (next == null) return
                if (next.retryAt > now) null else records.filter { it.batchId == records.filter { candidate -> candidate.retryAt <= now }.minBy { it.capturedAt }.batchId }
            }
            if (batch == null) {
                val retryAt = mutex.withLock { records.minOfOrNull { it.retryAt } } ?: return
                delay((retryAt - System.currentTimeMillis()).coerceAtLeast(1L))
                continue
            }
            batch.forEach { onDeliveryState(UUID.fromString(it.id), ScanResult.DeliveryState.SENDING) }
            runCatching { upload(batch) }.onSuccess {
                val ids = batch.mapTo(hashSetOf()) { it.id }
                mutex.withLock { records.removeAll { it.id in ids }; save() }
                batch.forEach { onDeliveryState(UUID.fromString(it.id), ScanResult.DeliveryState.SENT) }
            }.onFailure {
                val ids = batch.mapTo(hashSetOf()) { it.id }
                mutex.withLock {
                    records.replaceAll { current ->
                        if (current.id !in ids) current else {
                            val attempts = current.attempts + 1
                            val base = min(300_000L, 1_000L shl min(attempts, 8))
                            current.copy(attempts = attempts, retryAt = System.currentTimeMillis() + base + Random.nextLong(0, base / 4 + 1))
                        }
                    }
                    save()
                }
                batch.forEach { onDeliveryState(UUID.fromString(it.id), ScanResult.DeliveryState.FAILED) }
            }
        }
    }
    private suspend fun upload(batch: List<Record>) {
        val credential = credentials.load() ?: throw MobileCloudError.CredentialRevoked
        val bytesById = batch.associate { it.id to it.photoBase64?.let(java.util.Base64.getDecoder()::decode) }
        val inputs = batch.map { record ->
            val bytes = bytesById[record.id]
            val checksum = bytes?.let { MessageDigest.getInstance("SHA-256").digest(it).joinToString("") { b -> "%02x".format(b) } }
            CloudResultInput(record.id, record.kind, record.value.takeIf { bytes == null }, record.format, if (bytes != null) "image/jpeg" else null, bytes?.size ?: record.value.toByteArray().size, checksum, record.capturedAt.toDouble())
        }
        val batchId = batch.first().batchId
        api.putBatch(PutCloudBatchRequest(credential.deviceId, credential.value, batchId, batch.minOf { it.capturedAt }.toDouble(), inputs))
        batch.forEach { record ->
            val bytes = bytesById[record.id] ?: return@forEach
            val upload = api.createPhotoUploadUrl(CreatePhotoUploadURLRequest(credential.deviceId, credential.value, batchId, record.id, "image/jpeg", bytes.size))
            api.uploadPhoto(bytes, upload)
        }
        api.markBatchReady(MarkCloudBatchReadyRequest(credential.deviceId, credential.value, batchId))
    }
    private fun load(): List<Record> = runCatching { MobileCloudApiClient.json.decodeFromString<Manifest>(file.readText()).records }.getOrDefault(emptyList())
    private fun save() { file.parentFile?.mkdirs(); val temporary = File(file.parentFile, "${file.name}.tmp"); temporary.writeText(MobileCloudApiClient.json.encodeToString(Manifest(records))); if (!temporary.renameTo(file)) { file.writeText(temporary.readText()); temporary.delete() } }
    override fun close() { scope.cancel() }
}
