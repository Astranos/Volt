package com.volt.mobile.service

import com.volt.mobile.model.CaptureMode
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ScannerProtocolTest {
    @Test fun helloHasCanonicalNestedPeer() { val value = JsonObject(ScannerProtocol.hello("phone1", "chrome1", "Pixel")); val peer = value.getValue("peer").jsonObject; assertEquals("hello", value["type"]?.jsonPrimitive?.content); assertFalse("platform" in value); assertEquals("android", peer["platform"]?.jsonPrimitive?.content); assertEquals("chrome1", peer["chromeSessionId"]?.jsonPrimitive?.content); assertEquals("Pixel", peer["deviceLabel"]?.jsonPrimitive?.content); assertTrue("android" in ScannerProtocol.supportedPeerPlatforms) }
    @Test fun captureResultHasExpectedWireShape() { val objectValue = JsonObject(ScannerProtocol.captureResult("r1", "barcode", "123", "EAN_13", 0, true, "phone1")); assertEquals("capture_result", objectValue["type"]?.jsonPrimitive?.content); assertEquals("r1", objectValue["resultId"]?.jsonPrimitive?.content); assertEquals("barcode", objectValue["resultKind"]?.jsonPrimitive?.content); assertEquals("1970-01-01T00:00:00.000Z", objectValue["capturedAt"]?.jsonPrimitive?.content); assertTrue(objectValue["insertIntoCursor"]!!.jsonPrimitive.boolean); assertEquals("phone1", objectValue["contributorId"]?.jsonPrimitive?.content) }
    @Test fun parsesSessionReady() { val raw = """{"type":"session_ready","peer":{"chromeSessionId":"s1","deviceLabel":"Chrome","platform":"chrome_extension"},"activeMode":"ocr","pairing":{"pairingId":"p","pairingSecret":"secret","browserSessionId":"b"},"cursorTarget":{"tabTitle":"Doc","hasCursorTarget":true}}"""; val value = ScannerProtocol.parseSessionReady(raw); assertNotNull(value); assertEquals(CaptureMode.OCR, value?.activeMode); assertEquals("p", value?.pairing?.pairingId); assertEquals("Doc", value?.cursorTarget?.tabTitle) }
    @Test fun rejectsWrongEnvelopeType() { assertNull(ScannerProtocol.parseSessionReady("""{"type":"result_received"}""")) }
}
