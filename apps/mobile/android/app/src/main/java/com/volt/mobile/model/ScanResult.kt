package com.volt.mobile.model

import java.util.UUID

/** A single capture, mirroring iOS `Models/ScanResult.swift`. */
data class ScanResult(
    val id: UUID = UUID.randomUUID(),
    val kind: Kind,
    val source: Source = Source.CAPTURE,
    val value: String,
    val format: String,
    val capturedAt: Long = System.currentTimeMillis(),
    /** User-facing session identity; reuses the cloud batch ID until the server adds one. */
    val batchId: String? = null,
    var deliveryState: DeliveryState = DeliveryState.SAVED,
    val imageBytes: ByteArray? = null,
) {
    enum class Kind(val rawValue: String) {
        BARCODE("barcode"),
        TEXT("text"),
        PHOTO("photo"),
        DICTATION("dictation"),
        ;

        companion object {
            fun fromRaw(value: String?): Kind? = entries.firstOrNull { it.rawValue == value }
        }
    }

    enum class Source(val rawValue: String) {
        CAPTURE("capture"),
        DICTATION("dictation"),
        UPLOAD("upload"),
    }

    enum class DeliveryState(val rawValue: String, val label: String) {
        SAVED("saved", "Saved on device"),
        SENDING("sending", "Insertion pending"),
        SENT("sent", "Synced"),
        FAILED("failed", "Insertion failed"),
        ;
    }
}
