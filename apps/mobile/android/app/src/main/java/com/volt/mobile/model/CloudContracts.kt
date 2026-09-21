package com.volt.mobile.model

import kotlinx.serialization.Serializable

/**
 * Cloud API request/response contracts, mirroring iOS `Models/CloudAPIContracts.swift`.
 * Field names must stay byte-compatible with the Convex HTTP actions.
 */
@Serializable
data class BootstrapMobileDeviceRequest(
    val installationId: String,
    val label: String,
    val existingDeviceId: String? = null,
)

@Serializable
data class BootstrapMobileDeviceResponse(
    val deviceId: String,
    val deviceSecret: String,
    val workspaceId: String,
    val clerkUserId: String,
)

@Serializable
data class CloudResultInput(
    val resultId: String,
    val kind: String,
    val text: String? = null,
    val format: String? = null,
    val contentType: String? = null,
    val byteCount: Int,
    val checksum: String? = null,
    val clientCreatedAt: Double,
)

@Serializable
data class PutCloudBatchRequest(
    val deviceId: String,
    val deviceSecret: String,
    val batchId: String,
    val clientCreatedAt: Double,
    val results: List<CloudResultInput>,
)

@Serializable
data class PutCloudBatchResponse(
    val batchId: String,
    val idempotent: Boolean,
    val status: String,
)

@Serializable
data class CreatePhotoUploadURLRequest(
    val deviceId: String,
    val deviceSecret: String,
    val batchId: String,
    val resultId: String,
    val contentType: String,
    val byteCount: Int,
)

@Serializable
data class PresignedPhotoUpload(
    val url: String,
    val headers: Map<String, String> = emptyMap(),
)

@Serializable
data class MarkCloudBatchReadyRequest(
    val deviceId: String,
    val deviceSecret: String,
    val batchId: String,
)

@Serializable
data class CloudComputer(
    val deviceId: String,
    val label: String,
    val capabilities: List<String> = emptyList(),
    val online: Boolean = false,
) {
    val supportsCursorInsertion: Boolean get() = "cursor-insertion" in capabilities
}

@Serializable
data class ListCloudComputersRequest(
    val deviceId: String,
    val deviceSecret: String,
)

@Serializable
data class ListCloudComputersResponse(
    val cursorTargetDeviceId: String? = null,
    val computers: List<CloudComputer> = emptyList(),
)

@Serializable
data class SetCursorTargetRequest(
    val deviceId: String,
    val deviceSecret: String,
    val cursorTargetDeviceId: String?,
)

@Serializable
data class SetCursorTargetResponse(
    val cursorTargetDeviceId: String? = null,
)

@Serializable
data class QueueCursorDeliveryRequest(
    val deviceId: String,
    val deviceSecret: String,
    val deliveryId: String,
    val resultId: String,
    val targetDeviceId: String,
    val kind: String,
    val text: String,
    val format: String? = null,
    val clientCreatedAt: Double,
)

@Serializable
data class QueueCursorDeliveryResponse(
    val deliveryId: String,
    val idempotent: Boolean,
    val state: String,
)

@Serializable
data class CursorDeliveryStatusRequest(
    val deviceId: String,
    val deviceSecret: String,
    val deliveryIds: List<String>,
)

@Serializable
data class CursorDeliveryStatus(
    val deliveryId: String,
    val state: String,
    val errorCode: String? = null,
    val deliveredAt: Double? = null,
) {
    val isTerminal: Boolean get() = state == "delivered" || state == "failed"
}

@Serializable
data class CursorDeliveryStatusResponse(
    val statuses: List<CursorDeliveryStatus> = emptyList(),
)
