package com.xateenergia.vendedoresminum.data.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

@Entity(
    tableName = "planned_route_stops",
    primaryKeys = ["routeId", "customerId"],
    foreignKeys = [
        ForeignKey(
            entity = PlannedRouteEntity::class,
            parentColumns = ["id"],
            childColumns = ["routeId"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = CustomerEntity::class,
            parentColumns = ["id"],
            childColumns = ["customerId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("routeId"), Index("customerId")]
)
data class PlannedRouteStopEntity(
    val routeId: Long,
    val customerId: Long,
    val orderIndex: Int,
    val distanceMeters: Double
)

