package com.xateenergia.vendedoresminum.domain.model

data class NearbyCustomer(
    val customer: Customer,
    val distanceMeters: Double,
    val selected: Boolean = false,
    val routeOrder: Int? = null
) {
    val distanceKm: Double
        get() = distanceMeters / 1000.0
}

