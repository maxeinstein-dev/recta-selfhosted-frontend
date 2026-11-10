package dev.maxsueleinstein.recta.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureBatchTest {
    private val pkg = "com.nu.production"
    private val at = 1_700_000_000_000L // 2023-11-14T22:13:20Z

    private fun item(i: Int = 0) = CaptureItem(pkg, "T$i", "X$i", at + i)

    @Test
    fun splitsAQueueIntoBatchesOfAtMostFifty() {
        val items = (0 until 120).map { item(it) }
        val chunks = CaptureBatch.chunks(items)
        assertEquals(listOf(50, 50, 20), chunks.map { it.size })
        // The order is kept across batches.
        assertEquals(items, chunks.flatten())
        assertEquals(listOf(50), CaptureBatch.chunks((0 until 50).map { item(it) }).map { it.size })
        assertEquals(listOf(1), CaptureBatch.chunks(listOf(item())).map { it.size })
        assertTrue(CaptureBatch.chunks(emptyList<CaptureItem>()).isEmpty())
    }

    @Test
    fun formatsTheTimeAsIsoInstantWithAZone() {
        assertEquals("2023-11-14T22:13:20Z", CaptureBatch.isoTime(at))
        assertEquals("2023-11-14T22:13:20.123Z", CaptureBatch.isoTime(at + 123))
    }

    @Test
    fun buildsTheBodyTheServerExpects() {
        val body = CaptureBatch.toJson(listOf(CaptureItem(pkg, "A \"B\"", "linha1\nlinha2\\", at)))
        val expected =
            """{"items":[{"package":"com.nu.production","title":"A \"B\"","text":"linha1\nlinha2\\","postedAt":"2023-11-14T22:13:20Z"}]}"""
        assertEquals(expected, body)
    }

    @Test
    fun omitsTheTitleWhenThereIsNone() {
        val body = CaptureBatch.toJson(listOf(CaptureItem(pkg, null, "so texto", at)))
        assertFalse(body.contains("title"))
        assertEquals("""{"items":[{"package":"com.nu.production","text":"so texto","postedAt":"2023-11-14T22:13:20Z"}]}""", body)
    }

    @Test
    fun separatesItemsWithCommas() {
        val body = CaptureBatch.toJson(listOf(item(1), item(2)))
        assertEquals(2, Regex("\"package\"").findAll(body).count())
        assertTrue(body.contains("},{\"package\""))
    }

    @Test
    fun escapesControlCharactersAndLineSeparators() {
        assertEquals("\"a\\u0001b\"", CaptureBatch.quote("a\u0001b"))
        assertEquals("\"\\t\\r\\n\\b\\f\"", CaptureBatch.quote("\t\r\n\b\u000C"))
        assertEquals("\"\\u2028\\u2029\"", CaptureBatch.quote("  "))
        // Accents and emoji go through as they are.
        assertEquals("\"R\$ 10,50 à vista 😀\"", CaptureBatch.quote("R\$ 10,50 à vista 😀"))
    }

    @Test
    fun refusesAnEmptyBatchOrOneOverTheLimit() {
        assertThrows(IllegalArgumentException::class.java) { CaptureBatch.toJson(emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { CaptureBatch.toJson((0 until 51).map { item(it) }) }
        assertTrue(CaptureBatch.toJson((0 until 50).map { item(it) }).isNotEmpty())
    }

    @Test
    fun acceptsOnlyHttpsApiUrlsAndNormalizesThem() {
        assertEquals("https://recta-api.example.dev", CaptureEndpoint.normalizeApiUrl("https://recta-api.example.dev/"))
        assertEquals("https://recta-api.example.dev", CaptureEndpoint.normalizeApiUrl("  https://recta-api.example.dev  "))
        assertEquals("https://host.example:8443/api", CaptureEndpoint.normalizeApiUrl("HTTPS://Host.Example:8443/api/"))
        assertNull(CaptureEndpoint.normalizeApiUrl("http://recta-api.example.dev"))
        assertNull(CaptureEndpoint.normalizeApiUrl("ftp://recta-api.example.dev"))
        assertNull(CaptureEndpoint.normalizeApiUrl("https://user:secret@recta-api.example.dev"))
        assertNull(CaptureEndpoint.normalizeApiUrl("https://recta-api.example.dev?x=1"))
        assertNull(CaptureEndpoint.normalizeApiUrl("https://recta-api.example.dev#frag"))
        assertNull(CaptureEndpoint.normalizeApiUrl("not a url"))
        assertNull(CaptureEndpoint.normalizeApiUrl("https://"))
        assertNull(CaptureEndpoint.normalizeApiUrl(""))
        assertNull(CaptureEndpoint.normalizeApiUrl(null))
    }

    @Test
    fun buildsTheCapturesUrl() {
        assertEquals("https://recta-api.example.dev/captures", CaptureEndpoint.capturesUrl("https://recta-api.example.dev"))
        assertEquals("https://h.example/api/captures", CaptureEndpoint.capturesUrl("https://h.example/api/"))
    }

    @Test
    fun recognisesTheShapeOfADeviceToken() {
        val body43 = "A".repeat(43)
        assertTrue(CaptureEndpoint.looksLikeDeviceToken("rdt_$body43"))
        assertTrue(CaptureEndpoint.looksLikeDeviceToken("rdt_" + "aB3_-".repeat(9)))
        assertFalse(CaptureEndpoint.looksLikeDeviceToken("rdt_short"))
        assertFalse(CaptureEndpoint.looksLikeDeviceToken("xyz_$body43"))
        assertFalse(CaptureEndpoint.looksLikeDeviceToken("rdt_" + "A".repeat(42) + "."))
        assertFalse(CaptureEndpoint.looksLikeDeviceToken("eyJhbGciOiJIUzI1NiJ9.e30.abc"))
        assertFalse(CaptureEndpoint.looksLikeDeviceToken(null))
    }
}
