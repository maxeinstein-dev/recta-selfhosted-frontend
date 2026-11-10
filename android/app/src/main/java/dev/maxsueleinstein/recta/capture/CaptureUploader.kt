package dev.maxsueleinstein.recta.capture

import android.content.Context
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** How a run ended, for the worker: DONE (nothing left to do or nothing can be done), RETRY (try again later), STOPPED (auth). */
enum class UploadResult { DONE, RETRY, STOPPED }

/** One POST to /captures. Returns the HTTP status; throws [IOException] when there was no answer. */
fun interface CaptureTransport {
    fun post(url: String, token: String, body: ByteArray): Int
}

/**
 * HttpURLConnection on purpose (no extra dependency). The long read timeout covers a free-plan API waking up, which can
 * take about a minute. The token goes in the Authorization header and nowhere else; nothing is logged.
 */
class HttpCaptureTransport : CaptureTransport {
    override fun post(url: String, token: String, body: ByteArray): Int {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.instanceFollowRedirects = false
            connection.setFixedLengthStreamingMode(body.size)
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            // Read the answer to the end so the connection can be reused; its content is not needed (any 2xx is a success).
            (if (status >= 400) connection.errorStream else connection.inputStream)?.use { stream ->
                val buffer = ByteArray(4096)
                while (stream.read(buffer) != -1) { /* drain */ }
            }
            return status
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 30_000
        const val READ_TIMEOUT_MS = 90_000
    }
}

/**
 * Sends the queue. One run at a time per process (the mutex), so a manual "send now" and the scheduled worker never
 * upload the same rows in parallel. The server de-duplicates, so a run that is cancelled after the request went out and
 * sends the same rows again is harmless.
 */
object CaptureUploader {
    private val mutex = Mutex()

    /** Batches per run: 200 x 50 = 10,000 notifications, far above any real queue. */
    private const val MAX_BATCHES_PER_RUN = 200
    private const val SENT_RETENTION_MS = 14L * 24 * 60 * 60 * 1000

    suspend fun run(
        context: Context,
        manual: Boolean,
        transport: CaptureTransport = HttpCaptureTransport(),
    ): UploadResult = mutex.withLock {
        val config = CaptureConfig(context)
        val dao = CaptureDatabase.get(context).dao()

        // A manual "send now" is the user's way to try again after an auth stop (for example, the owner got the role back).
        if (manual) config.authBlocked = false

        if (dao.count(QueueStatus.PENDING) == 0) return@withLock UploadResult.DONE
        if (config.authBlocked) return@withLock UploadResult.STOPPED

        val apiUrl = config.apiUrl()
        val token = config.token()
        if (apiUrl.isNullOrEmpty() || token.isNullOrEmpty()) {
            config.setError("NO_TOKEN", "Device is not linked: queued notifications wait for a link.")
            return@withLock UploadResult.DONE
        }
        val url = CaptureEndpoint.capturesUrl(apiUrl)

        var result = UploadResult.DONE
        var batches = 0
        while (batches < MAX_BATCHES_PER_RUN) {
            val rows = dao.pending(CaptureBatch.MAX_ITEMS)
            if (rows.isEmpty()) break
            batches += 1
            val step = sendRows(rows, url, token, dao, config, transport)
            if (step != UploadResult.DONE) {
                result = step
                break
            }
        }
        if (result == UploadResult.DONE && batches >= MAX_BATCHES_PER_RUN) result = UploadResult.RETRY

        dao.purgeSent(System.currentTimeMillis() - SENT_RETENTION_MS)
        result
    }

    /** Sends [rows] as one batch; on a refusal of a batch, row by row. Returns DONE when every row was settled. */
    private suspend fun sendRows(
        rows: List<CapturedNotificationEntity>,
        url: String,
        token: String,
        dao: CaptureDao,
        config: CaptureConfig,
        transport: CaptureTransport,
    ): UploadResult {
        val ids = rows.map { it.id }
        val body = CaptureBatch.toJson(rows.map { it.toItem() }).toByteArray(Charsets.UTF_8)
        val status: Int = try {
            withContext(Dispatchers.IO) { transport.post(url, token, body) }
        } catch (e: IOException) {
            return settleRetry(ids, "Network error (${e.javaClass.simpleName})", dao, config)
        }
        val outcome = RetryPolicy.classify(status)

        // Writes are not cancellable: once the answer is known, the queue must reflect it.
        return withContext(NonCancellable) {
            when (RetryPolicy.decide(outcome, rows.size)) {
                Action.MARK_SENT -> {
                    val now = System.currentTimeMillis()
                    dao.markSent(ids, now)
                    config.lastSentAtMillis = now
                    if (config.errorCode() != "AUTH") config.clearError()
                    UploadResult.DONE
                }
                Action.KEEP_AND_RETRY -> settleRetry(ids, "HTTP $status", dao, config)
                Action.STOP_AUTH -> {
                    config.authBlocked = true
                    config.setError("AUTH", "HTTP $status: the device token was revoked or is no longer accepted. Link the device again.")
                    UploadResult.STOPPED
                }
                Action.SPLIT -> {
                    var split = UploadResult.DONE
                    for (row in rows) {
                        val one = sendRows(listOf(row), url, token, dao, config, transport)
                        if (one != UploadResult.DONE) {
                            split = one
                            break
                        }
                    }
                    split
                }
                Action.MARK_REJECTED -> {
                    dao.markRejected(ids, "HTTP $status")
                    config.setError("REJECTED", "HTTP $status: the server refused one notification; it is kept as rejected.")
                    UploadResult.DONE
                }
            }
        }
    }

    private suspend fun settleRetry(ids: List<Long>, reason: String, dao: CaptureDao, config: CaptureConfig): UploadResult =
        withContext(NonCancellable) {
            dao.markAttempt(ids, reason)
            config.setError("RETRY", "$reason. Will try again.")
            UploadResult.RETRY
        }
}
