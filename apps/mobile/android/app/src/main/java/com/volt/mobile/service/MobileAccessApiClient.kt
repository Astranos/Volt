package com.volt.mobile.service

import com.volt.mobile.AppConfiguration
import com.volt.mobile.model.AccessStatus
import com.volt.mobile.model.MobileAccessErrorResponse
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

sealed class MobileAccessError(message: String) : IOException(message) {
    data object InvalidResponse : MobileAccessError("The access service returned an invalid response.")
    data class Rejected(val statusCode: Int, val detail: String?) : MobileAccessError(detail ?: "The access service rejected the request ($statusCode).")
}
@Serializable private data class TransactionRequest(val signedTransaction: String)

class MobileAccessApiClient(private val client: OkHttpClient = OkHttpClient(), private val baseUrl: String = AppConfiguration.convexSiteUrl.toString().trimEnd('/')) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    suspend fun fetchStatus(bearerToken: String): AccessStatus = request("api/access/status", bearerToken, null)
    suspend fun synchronizeTransaction(signedTransaction: String, bearerToken: String) { request<Unit>("api/storekit/transactions", bearerToken, json.encodeToString(TransactionRequest(signedTransaction))) }
    private suspend inline fun <reified T> request(path: String, token: String, body: String?): T = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("$baseUrl/$path").header("Authorization", "Bearer $token").header("Accept", "application/json")
        if (body != null) builder.header("Content-Type", "application/json").post(body.toRequestBody("application/json".toMediaType()))
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val detail = runCatching { json.decodeFromString<MobileAccessErrorResponse>(text) }.getOrNull()?.let { it.error ?: it.detail }
                throw MobileAccessError.Rejected(response.code, detail)
            }
            if (T::class == Unit::class) Unit as T else runCatching { json.decodeFromString<T>(text) }.getOrElse { throw MobileAccessError.InvalidResponse }
        }
    }
}
