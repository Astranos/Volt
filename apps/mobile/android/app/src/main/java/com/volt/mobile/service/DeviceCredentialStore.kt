package com.volt.mobile.service

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.volt.mobile.model.CloudDeviceCredential

class DeviceCredentialStore(context: Context) {
    companion object { const val SERVICE = "com.volt.mobile.cloud-device"; private const val ACCOUNT = "workspace-credential" }
    private val json = MobileCloudApiClient.json
    private val preferences = EncryptedSharedPreferences.create(
        context, SERVICE, MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    fun load(): CloudDeviceCredential? = preferences.getString(ACCOUNT, null)?.let { runCatching { json.decodeFromString<CloudDeviceCredential>(it) }.getOrNull() }
    fun save(credential: CloudDeviceCredential) { preferences.edit().putString(ACCOUNT, json.encodeToString(CloudDeviceCredential.serializer(), credential)).commit() }
    fun remove() { preferences.edit().remove(ACCOUNT).commit() }
}
