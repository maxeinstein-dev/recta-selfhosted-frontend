package dev.maxsueleinstein.recta.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AllowedPackagesTest {
    @Test
    fun allowsTheBankAppsOnTheList() {
        assertTrue(AllowedPackages.isAllowed("com.nu.production"))
        assertTrue(AllowedPackages.isAllowed("com.mercadopago.wallet"))
    }

    @Test
    fun theListHoldsExactlyTheTwoBankApps() {
        assertEquals(setOf("com.nu.production", "com.mercadopago.wallet"), AllowedPackages.ALLOWED)
    }

    @Test
    fun refusesEveryOtherPackage() {
        assertFalse(AllowedPackages.isAllowed(null))
        assertFalse(AllowedPackages.isAllowed(""))
        assertFalse(AllowedPackages.isAllowed("com.whatsapp"))
        assertFalse(AllowedPackages.isAllowed("com.google.android.apps.messaging"))
        // Look-alikes: prefix, suffix, case and whitespace do not count.
        assertFalse(AllowedPackages.isAllowed("com.nu.production.fake"))
        assertFalse(AllowedPackages.isAllowed("com.nu"))
        assertFalse(AllowedPackages.isAllowed("COM.NU.PRODUCTION"))
        assertFalse(AllowedPackages.isAllowed(" com.nu.production"))
    }

    @Test
    fun aNotificationFromAnotherPackageNeverBecomesAnItem() {
        val item = NotificationFilter.build("com.whatsapp", "Ana", "Oi, tudo bem?", null, null, 1_700_000_000_000L)
        assertNull(item)
    }

    @Test
    fun aNotificationFromAnAllowedPackageBecomesAnItem() {
        val item = NotificationFilter.build("com.nu.production", "Compra aprovada", "Compra de R$ 10,00 em LOJA TESTE", null, null, 1_700_000_000_000L)
        assertEquals("com.nu.production", item?.packageName)
        assertEquals("Compra aprovada", item?.title)
        assertEquals("Compra de R$ 10,00 em LOJA TESTE", item?.text)
        assertEquals(1_700_000_000_000L, item?.postedAtMillis)
    }
}
