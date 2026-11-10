package dev.maxsueleinstein.recta.capture

import java.security.MessageDigest

/** One notification as it is queued and sent. Raw text only: parsing is done by the server. */
data class CaptureItem(
    val packageName: String,
    val title: String?,
    val text: String,
    val postedAtMillis: Long,
)

/** Limits of POST /captures (captures.schema.ts); the strings are cut to them here so one long text never fails a batch. */
object CaptureLimits {
    const val PACKAGE_MAX = 150
    const val TITLE_MAX = 300
    const val TEXT_MAX = 2000
}

/** Turns what the system hands the listener into a [CaptureItem], or null when it must not be captured. */
object NotificationFilter {
    /**
     * @param text the normal body (EXTRA_TEXT); @param bigText the expanded body (EXTRA_BIG_TEXT);
     * @param lines the inbox lines (EXTRA_TEXT_LINES). The longest non-blank source wins, because the collapsed text of a
     * notification is often a cut version of the expanded one.
     */
    fun build(
        packageName: String?,
        title: CharSequence?,
        text: CharSequence?,
        bigText: CharSequence?,
        lines: List<CharSequence>?,
        postTimeMillis: Long,
    ): CaptureItem? {
        if (packageName == null || !AllowedPackages.isAllowed(packageName)) return null
        if (packageName.length > CaptureLimits.PACKAGE_MAX) return null

        val candidates = listOfNotNull(
            clean(bigText),
            clean(text),
            clean(lines?.joinToString("\n") { it.toString() }),
        )
        val body = candidates.maxByOrNull { it.length } ?: return null
        return CaptureItem(
            packageName = packageName,
            title = clean(title)?.let { truncate(it, CaptureLimits.TITLE_MAX) },
            text = truncate(body, CaptureLimits.TEXT_MAX),
            postedAtMillis = postTimeMillis,
        )
    }

    /** NUL is refused by the server (and by Postgres), so it is dropped; blank becomes null. */
    internal fun clean(value: CharSequence?): String? {
        val cleaned = value?.toString()?.replace("\u0000", "")?.trim()
        return if (cleaned.isNullOrEmpty()) null else cleaned
    }

    /** Cuts to [max] UTF-16 units (what the server's zod `.max` counts) without leaving half a surrogate pair. */
    internal fun truncate(value: String, max: Int): String {
        if (value.length <= max) return value
        var end = max
        if (end > 0 && Character.isHighSurrogate(value[end - 1])) end -= 1
        return value.substring(0, end)
    }

    /**
     * Local de-duplication key, the same idea as the server's (package, minute, title, text). A notification the system
     * re-posts (an update of the same one) is queued once; the server de-duplicates again on its side.
     */
    fun dedupKey(item: CaptureItem): String {
        val minute = item.postedAtMillis / 60_000L
        val raw = "${item.packageName}|$minute|${item.title.orEmpty()}|${item.text}"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
