package dev.maxsueleinstein.recta.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationFilterTest {
    private val pkg = AllowedPackages.NUBANK
    private val at = 1_700_000_000_000L

    private fun build(
        title: CharSequence? = "Titulo",
        text: CharSequence? = "Texto",
        big: CharSequence? = null,
        lines: List<CharSequence>? = null,
    ) = NotificationFilter.build(pkg, title, text, big, lines, at)

    @Test
    fun dropsANotificationWithoutBody() {
        assertNull(build(text = null))
        assertNull(build(text = "   "))
        assertNull(build(text = "\u0000\u0000"))
    }

    @Test
    fun theTitleIsOptional() {
        assertNull(build(title = null)!!.title)
        assertNull(build(title = "  ")!!.title)
    }

    @Test
    fun theLongestBodyWins() {
        assertEquals("Texto expandido bem maior", build(text = "Texto curto", big = "Texto expandido bem maior")!!.text)
        assertEquals("Texto normal maior", build(text = "Texto normal maior", big = "curto")!!.text)
        assertEquals("linha 1\nlinha 2 bem comprida", build(text = null, lines = listOf("linha 1", "linha 2 bem comprida"))!!.text)
    }

    @Test
    fun stripsNulAndTrims() {
        val item = build(title = " T\u0000i ", text = "  a\u0000b  ")!!
        assertEquals("Ti", item.title)
        assertEquals("ab", item.text)
    }

    @Test
    fun cutsToTheServerLimits() {
        val item = build(title = "t".repeat(500), text = "x".repeat(5000))!!
        assertEquals(CaptureLimits.TITLE_MAX, item.title!!.length)
        assertEquals(CaptureLimits.TEXT_MAX, item.text.length)
    }

    @Test
    fun neverSplitsASurrogatePairWhenCutting() {
        // 1,999 letters then an emoji (2 UTF-16 units): the cut at 2,000 would land inside the pair.
        val text = "a".repeat(1999) + "😀" + "b"
        val cut = build(text = text)!!.text
        assertEquals(1999, cut.length)
        assertTrue(cut.all { it == 'a' })
    }

    @Test
    fun dedupKeyIsStableAndIgnoresTheSecondWithinTheSameMinute() {
        val a = CaptureItem(pkg, "T", "X", at)
        assertEquals(64, NotificationFilter.dedupKey(a).length)
        assertEquals(NotificationFilter.dedupKey(a), NotificationFilter.dedupKey(a.copy()))
        // Same minute bucket -> same key; a different minute, text, title or package -> a different key.
        val minuteStart = (at / 60_000L) * 60_000L
        assertEquals(
            NotificationFilter.dedupKey(a.copy(postedAtMillis = minuteStart)),
            NotificationFilter.dedupKey(a.copy(postedAtMillis = minuteStart + 59_999L)),
        )
        assertNotEquals(
            NotificationFilter.dedupKey(a.copy(postedAtMillis = minuteStart)),
            NotificationFilter.dedupKey(a.copy(postedAtMillis = minuteStart + 60_000L)),
        )
        assertNotEquals(NotificationFilter.dedupKey(a), NotificationFilter.dedupKey(a.copy(text = "Y")))
        assertNotEquals(NotificationFilter.dedupKey(a), NotificationFilter.dedupKey(a.copy(title = "U")))
        assertNotEquals(NotificationFilter.dedupKey(a), NotificationFilter.dedupKey(a.copy(packageName = AllowedPackages.MERCADO_PAGO)))
    }
}
