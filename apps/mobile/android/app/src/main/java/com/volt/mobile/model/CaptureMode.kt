package com.volt.mobile.model

/** Capture modes, mirroring iOS `Models/CaptureMode.swift`. */
enum class CaptureMode(val rawValue: String, val title: String) {
    OCR("ocr", "Text"),
    BARCODE("barcode", "Barcode"),
    PHOTO("photo", "Photo"),
    DICTATION("dictation", "Dictate"),
    ;

    companion object {
        fun fromRaw(value: String?): CaptureMode? = entries.firstOrNull { it.rawValue == value }
    }
}

enum class ProductScanMode(val rawValue: String, val title: String) {
    UPC("upc", "UPC"),
    NAME("name", "Name"),
    ;

    companion object {
        fun fromRaw(value: String?): ProductScanMode? =
            entries.firstOrNull { it.rawValue == value }
    }
}
