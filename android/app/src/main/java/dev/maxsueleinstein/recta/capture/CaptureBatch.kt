package dev.maxsueleinstein.recta.capture

import java.net.URI
import java.time.Instant
import java.time.format.DateTimeFormatter

/** The request body of POST /captures: `{"items":[{"package","title","text","postedAt"}]}`, 1 to 50 items. */
object CaptureBatch {
    const val MAX_ITEMS = 50

    /** Splits a queue into batches the API accepts, keeping the order. */
    fun <T> chunks(items: List<T>): List<List<T>> = items.chunked(MAX_ITEMS)

    /** ISO 8601 in UTC with a zone ("2026-11-09T14:03:21.123Z"): the server refuses a time without one. */
    fun isoTime(epochMillis: Long): String = DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(epochMillis))

    fun toJson(items: List<CaptureItem>): String {
        require(items.isNotEmpty()) { "A batch needs at least one item" }
        require(items.size <= MAX_ITEMS) { "A batch holds at most $MAX_ITEMS items" }
        val sb = StringBuilder(64 + items.size * 256)
        sb.append("{\"items\":[")
        items.forEachIndexed { index, item ->
            if (index > 0) sb.append(',')
            sb.append("{\"package\":").append(quote(item.packageName))
            // title is optional on the server: omitted when the notification has none.
            if (item.title != null) sb.append(",\"title\":").append(quote(item.title))
            sb.append(",\"text\":").append(quote(item.text))
            sb.append(",\"postedAt\":").append(quote(isoTime(item.postedAtMillis)))
            sb.append('}')
        }
        sb.append("]}")
        return sb.toString()
    }

    /** JSON string literal. Lone surrogates are left alone: encoding to UTF-8 turns them into '?', never into an escape. */
    internal fun quote(value: String): String {
        val sb = StringBuilder(value.length + 2)
        sb.append('"')
        for (ch in value) {
            when {
                ch == '"' -> sb.append("\\\"")
                ch == '\\' -> sb.append("\\\\")
                ch == '\n' -> sb.append("\\n")
                ch == '\r' -> sb.append("\\r")
                ch == '\t' -> sb.append("\\t")
                ch == '\b' -> sb.append("\\b")
                ch == '\u000C' -> sb.append("\\f")
                ch < ' ' || ch == ' ' || ch == ' ' -> sb.append("\\u").append("%04x".format(ch.code))
                else -> sb.append(ch)
            }
        }
        sb.append('"')
        return sb.toString()
    }
}

/** Where the batches go, and what a device token looks like. */
object CaptureEndpoint {
    /** Loose on purpose (the server decides what is valid): the `rdt_` prefix and a url-safe body. */
    private val TOKEN_SHAPE = Regex("^rdt_[A-Za-z0-9_-]{20,128}$")

    fun looksLikeDeviceToken(token: String?): Boolean = token != null && TOKEN_SHAPE.matches(token)

    /**
     * The API base URL as stored: https only, no credentials in it, no query or fragment, no trailing slash.
     * Returns null for anything else (cleartext http included: the token would travel in the clear).
     */
    fun normalizeApiUrl(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val uri = try {
            URI(trimmed)
        } catch (e: Exception) {
            return null
        }
        val host = uri.host
        if (!"https".equals(uri.scheme, ignoreCase = true)) return null
        if (host.isNullOrEmpty() || uri.userInfo != null || uri.query != null || uri.fragment != null) return null
        val path = (uri.rawPath ?: "").trimEnd('/')
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "https://${host.lowercase()}$port$path"
    }

    fun capturesUrl(apiUrl: String): String = apiUrl.trimEnd('/') + "/captures"
}
