package dev.maxsueleinstein.recta.capture

/** What an answer from POST /captures means for the batch that was sent. */
enum class Outcome {
    /** 2xx: the server stored the items (a repeat is also a 2xx, "duplicate"). */
    DELIVERED,

    /** The batch can work later: no network, timeout, a sleeping API (502/503/504), 429 and other 5xx. */
    RETRY,

    /** 401/403: the device token was revoked, or its owner can no longer add data. Retrying cannot fix it. */
    AUTH_STOP,

    /** 400/413/422: the server refuses this content. Retrying the same bytes will never work. */
    REJECTED,
}

/** What the uploader does next with the rows of the batch. */
enum class Action {
    MARK_SENT,

    /** Keep the rows queued, count the attempt, ask WorkManager to retry with its exponential backoff. */
    KEEP_AND_RETRY,

    /** Stop sending, record the error, leave the rows queued so a new link can send them. */
    STOP_AUTH,

    /** A batch was refused: send its rows one at a time, so one bad row does not hold back the others. */
    SPLIT,

    /** A single row was refused: it is kept as REJECTED (never resent) with the reason. */
    MARK_REJECTED,
}

object RetryPolicy {
    /**
     * Only 400/413/422 are treated as a refusal of the content. Everything else that is not 2xx or 401/403 (404 from a wrong
     * API address, 3xx, 408, 429, 5xx) may be fixed on the other side, so the rows stay queued and the error is shown.
     */
    fun classify(httpStatus: Int): Outcome = when (httpStatus) {
        in 200..299 -> Outcome.DELIVERED
        401, 403 -> Outcome.AUTH_STOP
        400, 413, 422 -> Outcome.REJECTED
        else -> Outcome.RETRY
    }

    /** A failure before any answer (no route, DNS, timeout, TLS) is always worth another try. */
    fun classifyFailure(): Outcome = Outcome.RETRY

    fun decide(outcome: Outcome, batchSize: Int): Action = when (outcome) {
        Outcome.DELIVERED -> Action.MARK_SENT
        Outcome.RETRY -> Action.KEEP_AND_RETRY
        Outcome.AUTH_STOP -> Action.STOP_AUTH
        Outcome.REJECTED -> if (batchSize > 1) Action.SPLIT else Action.MARK_REJECTED
    }

    /** Short code shown in the diagnostics screen; never contains the token or the notification text. */
    fun errorCode(outcome: Outcome): String = when (outcome) {
        Outcome.DELIVERED -> "NONE"
        Outcome.RETRY -> "RETRY"
        Outcome.AUTH_STOP -> "AUTH"
        Outcome.REJECTED -> "REJECTED"
    }
}
