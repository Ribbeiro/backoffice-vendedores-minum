package com.xateenergia.vendedoresminum.domain.model

data class CustomerFilters(
    val radiusKm: Double = 5.0,
    val segment: String? = null,
    val city: String? = null,
    val state: String? = null,
    val status: String? = null,
    val onlyWithPhone: Boolean = false,
    val onlyActive: Boolean = true
) {
    val radiusMeters: Double
        get() = radiusKm * 1000.0
}

