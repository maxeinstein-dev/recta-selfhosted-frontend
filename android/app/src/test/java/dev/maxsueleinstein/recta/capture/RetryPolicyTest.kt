package dev.maxsueleinstein.recta.capture

import org.junit.Assert.assertEquals
import org.junit.Test

class RetryPolicyTest {
    @Test
    fun anyTwoHundredStatusIsDelivered() {
        for (status in listOf(200, 201, 204, 299)) assertEquals("status $status", Outcome.DELIVERED, RetryPolicy.classify(status))
    }

    @Test
    fun aRevokedTokenStopsTheSending() {
        assertEquals(Outcome.AUTH_STOP, RetryPolicy.classify(401))
        assertEquals(Outcome.AUTH_STOP, RetryPolicy.classify(403))
    }

    @Test
    fun aSleepingOrOverloadedApiIsRetried() {
        // Render answers 502/503/504 while the free service wakes up; 429 is the rate limit; 408 a timeout.
        for (status in listOf(408, 425, 429, 500, 502, 503, 504, 520, 522, 599)) {
            assertEquals("status $status", Outcome.RETRY, RetryPolicy.classify(status))
        }
    }

    @Test
    fun aWrongAddressOrARedirectIsRetriedNotDropped() {
        // The rows must survive a misconfigured URL: the error is shown and the rows go out once it is fixed.
        for (status in listOf(301, 302, 307, 404, 405, 410)) {
            assertEquals("status $status", Outcome.RETRY, RetryPolicy.classify(status))
        }
    }

    @Test
    fun onlyContentRefusalsAreRejected() {
        for (status in listOf(400, 413, 422)) assertEquals("status $status", Outcome.REJECTED, RetryPolicy.classify(status))
    }

    @Test
    fun noAnswerAtAllIsRetried() {
        assertEquals(Outcome.RETRY, RetryPolicy.classifyFailure())
    }

    @Test
    fun theDecisionFollowsTheOutcome() {
        assertEquals(Action.MARK_SENT, RetryPolicy.decide(Outcome.DELIVERED, 50))
        assertEquals(Action.KEEP_AND_RETRY, RetryPolicy.decide(Outcome.RETRY, 1))
        assertEquals(Action.KEEP_AND_RETRY, RetryPolicy.decide(Outcome.RETRY, 50))
        assertEquals(Action.STOP_AUTH, RetryPolicy.decide(Outcome.AUTH_STOP, 1))
        assertEquals(Action.STOP_AUTH, RetryPolicy.decide(Outcome.AUTH_STOP, 50))
    }

    @Test
    fun aRefusedBatchIsSplitAndARefusedSingleRowIsMarkedRejected() {
        assertEquals(Action.SPLIT, RetryPolicy.decide(Outcome.REJECTED, 2))
        assertEquals(Action.SPLIT, RetryPolicy.decide(Outcome.REJECTED, 50))
        assertEquals(Action.MARK_REJECTED, RetryPolicy.decide(Outcome.REJECTED, 1))
    }

    @Test
    fun authNeverLoopsAndNeverMarksRowsAsSent() {
        // The two properties the uploader relies on to not hammer a revoked token.
        val action = RetryPolicy.decide(RetryPolicy.classify(401), 50)
        assertEquals(Action.STOP_AUTH, action)
        assertEquals("AUTH", RetryPolicy.errorCode(Outcome.AUTH_STOP))
    }
}
