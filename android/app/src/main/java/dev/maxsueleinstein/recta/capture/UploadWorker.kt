package dev.maxsueleinstein.recta.capture

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException

/**
 * Sends the queue when the network is up. [Result.retry] makes WorkManager wait with its exponential backoff (30 s, 60 s,
 * 120 s ... up to 5 h), which is how a sleeping API and missing signal are absorbed. An auth stop ends the run with
 * success on purpose: the state is in [CaptureConfig], and a failed result must not cancel the periodic safety net.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val manual = inputData.getBoolean(KEY_MANUAL, false)
        return try {
            when (CaptureUploader.run(applicationContext, manual)) {
                UploadResult.DONE -> Result.success()
                UploadResult.STOPPED -> Result.success()
                UploadResult.RETRY -> Result.retry()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // An unexpected failure (a database error, say) must not end the work for good: try again later.
            CaptureConfig(applicationContext).setError("RETRY", "Unexpected error (${e.javaClass.simpleName}). Will try again.")
            Result.retry()
        }
    }

    companion object {
        const val KEY_MANUAL = "manual"
    }
}

object UploadScheduler {
    private const val UNIQUE_NOW = "capture-upload"
    private const val UNIQUE_PERIODIC = "capture-upload-periodic"
    private const val BACKOFF_SECONDS = 30L

    private val needsNetwork: Constraints
        get() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /**
     * Runs a send as soon as there is a network. REPLACE restarts it (and its backoff) when something new arrives or the
     * user asks for it; that is safe because the server ignores rows it already has.
     */
    fun enqueue(context: Context, manual: Boolean = false) {
        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setConstraints(needsNetwork)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
            .setInputData(workDataOf(UploadWorker.KEY_MANUAL to manual))
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(UNIQUE_NOW, ExistingWorkPolicy.REPLACE, request)
    }

    /** Safety net: once an hour, with network, resend whatever is still queued (after a process death, a new link...). */
    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<UploadWorker>(1, TimeUnit.HOURS)
            .setConstraints(needsNetwork)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork(UNIQUE_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }
}
