package dev.maxsueleinstein.recta.capture

/**
 * The only apps whose notifications are ever read. A notification from any other package is dropped on the phone, before
 * anything is stored or sent: this is the single place that decides it (the listener calls [isAllowed] first).
 *
 * Both ids were confirmed on the target phone (SM-A556E, Android 16) with `adb shell pm list packages`.
 */
object AllowedPackages {
    const val NUBANK = "com.nu.production"
    const val MERCADO_PAGO = "com.mercadopago.wallet"

    val ALLOWED: Set<String> = setOf(NUBANK, MERCADO_PAGO)

    /** Exact match on the package name; null, blank or a look-alike id is refused. */
    fun isAllowed(packageName: String?): Boolean = packageName != null && packageName in ALLOWED
}
