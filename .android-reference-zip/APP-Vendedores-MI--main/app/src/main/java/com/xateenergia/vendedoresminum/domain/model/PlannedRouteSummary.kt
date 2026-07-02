package com.xateenergia.vendedoresminum.domain.model

data class PlannedRouteSummary(
    val id: Long,
    val name: String,
    val mainCustomerName: String?,
    val mainLatitude: Double,
    val mainLongitude: Double,
    val radiusKm: Double,
    val createdAt: Long,
    val stopCount: Int
)

