package com.xateenergia.vendedoresminum.presentation.navigation

object Destinations {
    const val AuthGate = "auth_gate"
    const val Login = "login"
    const val AccessDenied = "access_denied"
    const val Splash = "splash"
    const val Home = "home"
    const val Import = "import"
    const val Visit = "visit"
    const val Customers = "customers"
    const val Settings = "settings"
    const val History = "history"
    const val CustomerDetail = "customer/{customerId}"

    fun customerDetail(customerId: Long): String = "customer/$customerId"
}
