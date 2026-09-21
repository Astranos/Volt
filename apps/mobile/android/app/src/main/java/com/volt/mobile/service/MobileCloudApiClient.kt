package com.volt.mobile.service

import com.volt.mobile.AppConfiguration
import com.volt.mobile.model.*
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

interface MobileCloudApi {
    suspend fun bootstrapDevice(request: BootstrapMobileDeviceRequest, bearerToken: String): BootstrapMobileDeviceResponse
    suspend fun putBatch(request: PutCloudBatchRequest): PutCloudBatchResponse
    suspend fun createPhotoUploadUrl(request: CreatePhotoUploadURLRequest): PresignedPhotoUpload
    suspend fun uploadPhoto(bytes: ByteArray, upload: PresignedPhotoUpload)
    suspend fun markBatchReady(request: MarkCloudBatchReadyRequest)
    suspend fun listComputers(request: ListCloudComputersRequest): ListCloudComputersResponse
    suspend fun setCursorTarget(request: SetCursorTargetRequest): SetCursorTargetResponse
    suspend fun queueCursorDelivery(request: QueueCursorDeliveryRequest): QueueCursorDeliveryResponse
    suspend fun cursorDeliveryStatus(request: CursorDeliveryStatusRequest): CursorDeliveryStatusResponse
    suspend fun analyzeProductImage(bytes: ByteArray, mode: ProductScanMode, deviceId: String, deviceSecret: String, requestId: UUID): ProductScanResponse
}

sealed class MobileCloudError(message: String) : IOException(message) {
    data object CredentialRevoked : MobileCloudError("Volt couldn't reconnect this iPhone. Try again.")
    data object CloudWorkspaceRequired : MobileCloudError("Volt Pro cloud workspace access is required for cloud sync.")
    data class AiQuotaExhausted(val quota: AIScannerQuota?) : MobileCloudError("Your AI scan limit is used up for this period. Upgrade to Volt Pro or try again after it resets.")
    data class AiRateLimited(val quota: AIScannerQuota?) : MobileCloudError("AI scanning is busy right now. Try again in a moment.")
    data class HttpStatus(val status: Int) : MobileCloudError("Cloud sync failed with status $status.")
    data object InvalidResponse : MobileCloudError("Cloud sync returned an invalid response.")
}

class MobileCloudApiClient(
    private val client: OkHttpClient = OkHttpClient(),
    private val baseUrl: String = AppConfiguration.convexSiteUrl.toString().trimEnd('/'),
) : MobileCloudApi {
    companion object { val json = Json { ignoreUnknownKeys = true; encodeDefaults = true } }
    private val mediaType = "application/json".toMediaType()

    override suspend fun bootstrapDevice(request: BootstrapMobileDeviceRequest, bearerToken: String) =
        post<BootstrapMobileDeviceRequest, BootstrapMobileDeviceResponse>("api/mobile/devices/bootstrap", request, bearerToken)
    override suspend fun putBatch(request: PutCloudBatchRequest) = post<PutCloudBatchRequest, PutCloudBatchResponse>("api/mobile/outbox/sync", request)
    override suspend fun createPhotoUploadUrl(request: CreatePhotoUploadURLRequest) = post<CreatePhotoUploadURLRequest, PresignedPhotoUpload>("api/mobile/photos/upload-url", request)
    override suspend fun markBatchReady(request: MarkCloudBatchReadyRequest) { postUnit("api/mobile/batches/finalize", request) }
    override suspend fun listComputers(request: ListCloudComputersRequest) = post<ListCloudComputersRequest, ListCloudComputersResponse>("api/mobile/computers/list", request)
    override suspend fun setCursorTarget(request: SetCursorTargetRequest) = post<SetCursorTargetRequest, SetCursorTargetResponse>("api/mobile/cursor-target", request)
    override suspend fun queueCursorDelivery(request: QueueCursorDeliveryRequest) = post<QueueCursorDeliveryRequest, QueueCursorDeliveryResponse>("api/mobile/deliveries/queue", request)
    override suspend fun cursorDeliveryStatus(request: CursorDeliveryStatusRequest) = post<CursorDeliveryStatusRequest, CursorDeliveryStatusResponse>("api/mobile/deliveries/status", request)

    override suspend fun uploadPhoto(bytes: ByteArray, upload: PresignedPhotoUpload) = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(upload.url).put(bytes.toRequestBody())
        upload.headers.forEach(builder::header)
        client.newCall(builder.build()).execute().use { validate(it.code) }
    }

    override suspend fun analyzeProductImage(bytes: ByteArray, mode: ProductScanMode, deviceId: String, deviceSecret: String, requestId: UUID): ProductScanResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$baseUrl/api/mobile/ai/analyze?mode=${mode.rawValue}")
            .header("Content-Type", "image/jpeg").header("Accept", "application/json")
            .header("X-Volt-Device-Id", deviceId).header("X-Volt-Device-Secret", deviceSecret)
            .header("X-Volt-AI-Request-Id", requestId.toString().lowercase())
            .post(bytes.toRequestBody("image/jpeg".toMediaType())).build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.code == 429) {
                val payload = runCatching { json.decodeFromString<ProductScanErrorResponse>(body) }.getOrNull()
                when (payload?.errorCode) {
                    "quota-exhausted" -> throw MobileCloudError.AiQuotaExhausted(payload.quota)
                    "rate-limited" -> throw MobileCloudError.AiRateLimited(payload.quota)
                    else -> throw MobileCloudError.HttpStatus(429)
                }
            }
            validate(response.code)
            runCatching { json.decodeFromString<ProductScanResponse>(body) }.getOrElse { throw MobileCloudError.InvalidResponse }
        }
    }

    private suspend inline fun <reified Q : Any, reified R : Any> post(path: String, body: Q, bearer: String? = null): R = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("$baseUrl/$path").header("Content-Type", "application/json")
            .post(json.encodeToString(body).toRequestBody(mediaType))
        bearer?.let { builder.header("Authorization", "Bearer $it") }
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty(); validate(response.code)
            runCatching { json.decodeFromString<R>(text) }.getOrElse { throw MobileCloudError.InvalidResponse }
        }
    }
    private suspend inline fun <reified Q : Any> postUnit(path: String, body: Q) = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$baseUrl/$path").header("Content-Type", "application/json")
            .post(json.encodeToString(body).toRequestBody(mediaType)).build()
        client.newCall(request).execute().use { validate(it.code) }
    }
    private fun validate(code: Int) { when { code == 402 -> throw MobileCloudError.CloudWorkspaceRequired; code == 401 || code == 403 -> throw MobileCloudError.CredentialRevoked; code !in 200..299 -> throw MobileCloudError.HttpStatus(code) } }
}
