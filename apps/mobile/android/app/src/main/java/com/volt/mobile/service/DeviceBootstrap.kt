package com.volt.mobile.service

import android.content.Context
import com.volt.mobile.model.BootstrapMobileDeviceRequest
import com.volt.mobile.model.CloudDeviceCredential

class DeviceBootstrap(
    context: Context,
    private val cloudApi: MobileCloudApi,
    private val credentialStore: DeviceCredentialStore = DeviceCredentialStore(context),
) {
    suspend fun ensureBootstrapped(installationId: String, label: String, bearerToken: String) {
        val existing = credentialStore.load()
        if (existing != null && existing.value.isNotBlank() && existing.deviceId.isNotBlank()) return
        val response = cloudApi.bootstrapDevice(BootstrapMobileDeviceRequest(installationId, label, existing?.deviceId), bearerToken)
        credentialStore.save(CloudDeviceCredential(response.deviceSecret, response.deviceId, response.workspaceId, response.clerkUserId, System.currentTimeMillis()))
    }
}
