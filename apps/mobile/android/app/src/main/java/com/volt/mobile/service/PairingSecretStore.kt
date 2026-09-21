package com.volt.mobile.service

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.Serializable

class PairingSecretStore(context: Context) {
    @Serializable
    data class StoredPairing(val pairingId: String, val pairingSecret: String, val browserSessionId: String, val displayName: String)

    private val preferences = EncryptedSharedPreferences.create(
        context,
        "com.volt.mobile.pairing",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(): StoredPairing? = preferences.getString(KEY, null)?.let {
        runCatching { MobileCloudApiClient.json.decodeFromString<StoredPairing>(it) }.getOrNull()
    }

    fun save(pairing: ScannerProtocol.Pairing) {
        val stored = StoredPairing(pairing.pairingId, pairing.pairingSecret, pairing.browserSessionId, pairing.displayName ?: "Chrome session")
        preferences.edit().putString(KEY, MobileCloudApiClient.json.encodeToString(StoredPairing.serializer(), stored)).commit()
    }

    fun remove() { preferences.edit().remove(KEY).commit() }

    private companion object { const val KEY = "active-pairing" }
}
