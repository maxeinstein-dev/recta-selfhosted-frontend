package dev.maxsueleinstein.recta.capture

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Where the link to the API lives. The device token is only ever written to [EncryptedSharedPreferences] and is never
 * logged, returned to the web layer or put in an error text. The API URL, the device id and the status of the last attempt
 * are not secrets and sit in plain preferences. There is no plain-text fallback: if the keystore fails, the app is simply
 * "not linked" and says so.
 */
class CaptureConfig(context: Context) {
    private val appContext = context.applicationContext
    private val plain: SharedPreferences = appContext.getSharedPreferences(PLAIN_FILE, Context.MODE_PRIVATE)

    private val secure: SharedPreferences? by lazy {
        try {
            val masterKey = MasterKey.Builder(appContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(
                appContext,
                SECURE_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            null
        }
    }

    val secureStorageAvailable: Boolean get() = secure != null

    /** Saves the link (and clears any earlier auth stop). Returns false when the secure storage is unavailable. */
    fun saveLink(apiUrl: String, token: String, deviceId: String?): Boolean {
        val store = secure ?: return false
        if (!store.edit().putString(KEY_TOKEN, token).commit()) return false
        plain.edit()
            .putString(KEY_API_URL, apiUrl)
            .putString(KEY_DEVICE_ID, deviceId)
            .putBoolean(KEY_AUTH_BLOCKED, false)
            .remove(KEY_ERROR_CODE).remove(KEY_ERROR_MESSAGE).remove(KEY_ERROR_AT)
            .apply()
        return true
    }

    /** Forgets the token, the URL and the device id (queued rows stay; they are sent after a new link). */
    fun clearLink() {
        secure?.edit()?.remove(KEY_TOKEN)?.commit()
        plain.edit()
            .remove(KEY_API_URL).remove(KEY_DEVICE_ID)
            .putBoolean(KEY_AUTH_BLOCKED, false)
            .remove(KEY_ERROR_CODE).remove(KEY_ERROR_MESSAGE).remove(KEY_ERROR_AT)
            .apply()
    }

    /** Only for the uploader. Never pass this to logs or to the web layer. */
    fun token(): String? = try {
        secure?.getString(KEY_TOKEN, null)
    } catch (e: Exception) {
        null
    }

    fun apiUrl(): String? = plain.getString(KEY_API_URL, null)
    fun deviceId(): String? = plain.getString(KEY_DEVICE_ID, null)
    fun isLinked(): Boolean = !apiUrl().isNullOrEmpty() && !token().isNullOrEmpty()

    /** True after a 401/403: sending stays stopped until a new link or a manual "send now". */
    var authBlocked: Boolean
        get() = plain.getBoolean(KEY_AUTH_BLOCKED, false)
        set(value) {
            plain.edit().putBoolean(KEY_AUTH_BLOCKED, value).apply()
        }

    var lastSentAtMillis: Long?
        get() = if (plain.contains(KEY_LAST_SENT_AT)) plain.getLong(KEY_LAST_SENT_AT, 0L) else null
        set(value) {
            plain.edit().apply { if (value == null) remove(KEY_LAST_SENT_AT) else putLong(KEY_LAST_SENT_AT, value) }.apply()
        }

    /** [message] must be free of the token and of notification text (callers pass fixed phrases and status codes). */
    fun setError(code: String, message: String, atMillis: Long = System.currentTimeMillis()) {
        plain.edit().putString(KEY_ERROR_CODE, code).putString(KEY_ERROR_MESSAGE, message).putLong(KEY_ERROR_AT, atMillis).apply()
    }

    fun clearError() {
        plain.edit().remove(KEY_ERROR_CODE).remove(KEY_ERROR_MESSAGE).remove(KEY_ERROR_AT).apply()
    }

    fun errorCode(): String? = plain.getString(KEY_ERROR_CODE, null)
    fun errorMessage(): String? = plain.getString(KEY_ERROR_MESSAGE, null)
    fun errorAtMillis(): Long? = if (plain.contains(KEY_ERROR_AT)) plain.getLong(KEY_ERROR_AT, 0L) else null

    private companion object {
        const val PLAIN_FILE = "capture_state"
        const val SECURE_FILE = "capture_secure"
        const val KEY_TOKEN = "device_token"
        const val KEY_API_URL = "api_url"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_AUTH_BLOCKED = "auth_blocked"
        const val KEY_LAST_SENT_AT = "last_sent_at"
        const val KEY_ERROR_CODE = "error_code"
        const val KEY_ERROR_MESSAGE = "error_message"
        const val KEY_ERROR_AT = "error_at"
    }
}
