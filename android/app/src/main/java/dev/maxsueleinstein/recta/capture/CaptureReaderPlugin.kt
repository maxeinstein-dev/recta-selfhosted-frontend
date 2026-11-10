package dev.maxsueleinstein.recta.capture

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The bridge the web layer sees as `CaptureReader`. It never returns the device token: the web side hands it over once
 * ([configure]) and from then on only the native side uses it. Errors carry fixed messages, never token or notification text.
 */
@CapacitorPlugin(name = "CaptureReader")
class CaptureReaderPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun load() {
        UploadScheduler.schedulePeriodic(context)
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    /** { apiUrl, token, deviceId? }: stores the link. The token goes to EncryptedSharedPreferences. */
    @PluginMethod
    fun configure(call: PluginCall) {
        val apiUrl = CaptureEndpoint.normalizeApiUrl(call.getString("apiUrl"))
        if (apiUrl == null) {
            call.reject("The API address must be an https URL.", "INVALID_API_URL")
            return
        }
        val token = call.getString("token")
        if (!CaptureEndpoint.looksLikeDeviceToken(token)) {
            call.reject("That is not a device token.", "INVALID_TOKEN")
            return
        }
        val saved = CaptureConfig(context).saveLink(apiUrl, token!!, call.getString("deviceId"))
        if (!saved) {
            call.reject("The secure storage of this phone is not available.", "SECURE_STORAGE_UNAVAILABLE")
            return
        }
        // Whatever was queued before the link is sent now.
        UploadScheduler.enqueue(context)
        call.resolve()
    }

    /** Forgets the token, the URL and the device id on this phone. The queue is kept. */
    @PluginMethod
    fun clearLink(call: PluginCall) {
        CaptureConfig(context).clearLink()
        call.resolve()
    }

    /** { linked, apiUrl, deviceId, secureStorageAvailable } (no token). */
    @PluginMethod
    fun getLinkState(call: PluginCall) {
        val config = CaptureConfig(context)
        val state = JSObject()
        state.put("linked", config.isLinked())
        state.put("apiUrl", config.apiUrl() ?: JSONObject.NULL)
        state.put("deviceId", config.deviceId() ?: JSONObject.NULL)
        state.put("secureStorageAvailable", config.secureStorageAvailable)
        call.resolve(state)
    }

    /** { enabled }: whether this app is among the enabled notification listeners. */
    @PluginMethod
    fun getNotificationAccessState(call: PluginCall) {
        val enabled = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        call.resolve(JSObject().put("enabled", enabled))
    }

    @PluginMethod
    fun openNotificationAccessSettings(call: PluginCall) {
        launchSettings(call, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    /** App info of this app: where "Allow restricted settings" lives for an APK installed from outside the store. */
    @PluginMethod
    fun openAppDetailsSettings(call: PluginCall) {
        launchSettings(call, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
    }

    /** { ignoringOptimizations }: true when the system does not restrict this app's battery use. */
    @PluginMethod
    fun getBatteryState(call: PluginCall) {
        val power = context.getSystemService(PowerManager::class.java)
        val ignoring = power?.isIgnoringBatteryOptimizations(context.packageName) ?: false
        call.resolve(JSObject().put("ignoringOptimizations", ignoring))
    }

    /** The system list of battery optimizations (no special permission needed, unlike the direct request dialog). */
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        launchSettings(call, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    /** { pending, sent, rejected, lastSentAt, lastError, lastErrorCode, lastErrorAt, authBlocked }. */
    @PluginMethod
    fun getQueueState(call: PluginCall) {
        scope.launch {
            try {
                val dao = CaptureDatabase.get(context).dao()
                val config = CaptureConfig(context)
                val state = JSObject()
                state.put("pending", dao.count(QueueStatus.PENDING))
                state.put("sent", dao.count(QueueStatus.SENT))
                state.put("rejected", dao.count(QueueStatus.REJECTED))
                state.put("lastSentAt", config.lastSentAtMillis ?: JSONObject.NULL)
                state.put("lastError", config.errorMessage() ?: JSONObject.NULL)
                state.put("lastErrorCode", config.errorCode() ?: JSONObject.NULL)
                state.put("lastErrorAt", config.errorAtMillis() ?: JSONObject.NULL)
                state.put("authBlocked", config.authBlocked)
                call.resolve(state)
            } catch (e: Exception) {
                call.reject("Could not read the queue.", "QUEUE_UNAVAILABLE")
            }
        }
    }

    /** Schedules a send right away (it runs as soon as there is a network) and returns without waiting for it. */
    @PluginMethod
    fun sendNow(call: PluginCall) {
        UploadScheduler.enqueue(context, manual = true)
        call.resolve()
    }

    /** { name }: "Manufacturer Model", the default name of the device on the server. */
    @PluginMethod
    fun getDeviceName(call: PluginCall) {
        val name = listOf(Build.MANUFACTURER, Build.MODEL).filter { !it.isNullOrBlank() }.joinToString(" ").take(100)
        call.resolve(JSObject().put("name", name.ifBlank { "Android" }))
    }

    private fun launchSettings(call: PluginCall, intent: Intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: ActivityNotFoundException) {
            call.reject("This settings screen is not available on this phone.", "SETTINGS_UNAVAILABLE")
        }
    }
}
