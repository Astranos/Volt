package com.volt.mobile.service

import com.volt.mobile.model.CaptureMode
import java.net.URI
import org.junit.Assert.*
import org.junit.Test

class PairingUrlParserTest {
    @Test fun parsesJoinTokenPathAndSignalBase() { val parsed = PairingUrlParser.parse("https://example.com/api/signal/join-token/abc123?mode=photo&label=Desk"); assertEquals("abc123", parsed.session?.token); assertEquals("https://example.com/api/signal", parsed.session?.signalUrl); assertEquals(CaptureMode.PHOTO, parsed.mode); assertEquals("Desk", parsed.session?.label) }
    @Test fun findsPairingUrlInText() { assertEquals(URI.create("https://example.com/api/signal/join-token/token"), PairingUrlParser.pairingUrlIn("scan (https://example.com/api/signal/join-token/token) now")) }
    @Test fun nonPairingUrlReturnsNoSession() { assertNull(PairingUrlParser.parse("https://example.com/hello").session) }
}
