package com.xateenergia.vendedoresminum.data.entities

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "planned_routes",
    indices = [Index("createdAt")]
)
data class PlannedRouteEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val mainCustomerName: String?,
    val mainLatitude: Double,
    val mainLongitude: Double,
    val radiusKm: Double,
    val createdAt: Long = System.currentTimeMillis()
)

