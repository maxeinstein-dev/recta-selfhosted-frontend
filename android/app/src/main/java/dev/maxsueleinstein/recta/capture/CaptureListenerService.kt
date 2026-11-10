package dev.maxsueleinstein.recta.capture

import android.app.Notification
import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Reads notifications. The first thing it does with each one is the package check ([AllowedPackages]): anything from a
 * package that is not on the list returns right there, so its title and text are never even read, let alone stored.
 * Nothing about a captured notification (text, title) is written to the log.
 */
class CaptureListenerService : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        if (!AllowedPackages.isAllowed(sbn.packageName)) return

        val extras = sbn.notification?.extras ?: return
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.filterNotNull()
        val item = NotificationFilter.build(
            packageName = sbn.packageName,
            title = extras.getCharSequence(Notification.EXTRA_TITLE),
            text = extras.getCharSequence(Notification.EXTRA_TEXT),
            bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT),
            lines = lines,
            postTimeMillis = sbn.postTime,
        ) ?: return

        val appContext = applicationContext
        scope.launch {
            CaptureRepository.enqueue(appContext, item)
            UploadScheduler.enqueue(appContext)
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        // Set up the hourly safety net and flush anything left over from before (a reboot, a process death).
        UploadScheduler.schedulePeriodic(applicationContext)
        UploadScheduler.enqueue(applicationContext)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        // One UI may unbind a listener; ask the system to bind it again.
        requestRebind(ComponentName(this, CaptureListenerService::class.java))
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
