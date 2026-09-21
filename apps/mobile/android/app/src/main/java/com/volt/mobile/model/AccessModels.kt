package com.volt.mobile.model

import kotlinx.serialization.Serializable

@Serializable
data class ProductScanResponse(
    val mode: String? = null,
    val value: String? = null,
    val quota: AIScannerQuota? = null,
)

@Serializable
data class ProductScanErrorResponse(
    val errorCode: String? = null,
    val quota: AIScannerQuota? = null,
)

/** Access entitlements, mirroring iOS `Models/AccessStatus.swift`. */
@Serializable
data class AccessCapabilities(
    val localCapture: Boolean = true,
    val cloudWorkspace: Boolean = false,
    val aiProductScanner: Boolean = true,
)

@Serializable
data class AIScannerQuota(
    val kind: String,
    val limit: Int? = null,
    val used: Int? = null,
    val remaining: Int? = null,
    /** Milliseconds since epoch, matching the server contract. */
    val resetsAt: Double? = null,
) {
    val isUnlimited: Boolean get() = kind == "unlimited"
}

@Serializable
data class AccessStatus(
    val access: String,
    val plan: String? = null,
    val capabilities: AccessCapabilities? = null,
    val aiScannerQuota: AIScannerQuota? = null,
    val isAuthorized: Boolean,
    val hasFullAppAccess: Boolean? = null,
    val freeSessionsRemaining: Int,
    val requiresSignIn: Boolean,
    val requiresSubscription: Boolean,
    val subscriptionStatus: String,
    val productId: String? = null,
    val clerkUserId: String? = null,
    val organizationId: String? = null,
    val appAccountToken: String? = null,
    val expiresAt: String? = null,
)

@Serializable
data class MobileAccessErrorResponse(
    val error: String? = null,
    val detail: String? = null,
)

/** Stored per-device cloud credential, mirroring iOS `Models/CloudDeviceCredential.swift`. */
@Serializable
data class CloudDeviceCredential(
    val value: String,
    val deviceId: String,
    val workspaceId: String,
    val ownerClerkUserId: String? = null,
    val enrolledAt: Long,
)

/** Pairing deep-link payload, mirroring iOS `Models/PairingSession.swift`. */
data class PairingSession(
    val token: String?,
    val sessionId: String?,
    val attemptId: String?,
    val offer: String?,
    val answerUrl: String?,
    val label: String?,
    val signalUrl: String?,
    val cloudUrl: String? = null,
    val guestCloudGrant: String? = null,
    /** Milliseconds since epoch, or null. */
    val guestCloudExpiresAt: Long? = null,
    val sourceUrl: String,
) {
    val isPresent: Boolean
        get() = !token.isNullOrEmpty() ||
            !offer.isNullOrEmpty() ||
            !sessionId.isNullOrEmpty() ||
            !guestCloudGrant.isNullOrEmpty()
}
