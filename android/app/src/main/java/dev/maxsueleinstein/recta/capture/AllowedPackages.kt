package dev.maxsueleinstein.recta.capture

/**
 * The only apps whose notifications are ever read. A notification from any other package is dropped on the phone, before
 * anything is stored or sent: this is the single place that decides it (the listener calls [isAllowed] first).
 *
 * TODO(device check): these ids come from memory, not from the A55. Before the first collection week, confirm them on the
 * phone (`adb shell pm list packages | grep -i -E "nu|mercado"`, or Settings > Apps > the app > App details) and fix them here.
 */
object AllowedPackages {
    const val NUBANK = "com.nu.production"
    const val MERCADO_PAGO = "com.mercadopago.wallet"

    val ALLOWED: Set<String> = setOf(NUBANK, MERCADO_PAGO)

    /** Exact match on the package name; null, blank or a look-alike id is refused. */
    fun isAllowed(packageName: String?): Boolean = packageName != null && packageName in ALLOWED
}
