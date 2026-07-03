package com.xateenergia.vendedoresminum.data.remote

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.xateenergia.vendedoresminum.data.entities.CustomerEntity
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteEntity
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteStopEntity
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.tasks.await

@Singleton
class FirebaseSyncService @Inject constructor() {
    private val auth = FirebaseAuth.getInstance()
    private val database = FirebaseDatabase.getInstance()

    suspend fun fetchCustomers(): List<CustomerEntity> {
        val snapshot = database.getReference("customers").get().await()
        if (!snapshot.exists()) return emptyList()

        return snapshot.children.mapNotNull { child ->
            val value = child.value as? Map<*, *> ?: return@mapNotNull null
            val latitude = value.doubleValue("latitude") ?: return@mapNotNull null
            val longitude = value.doubleValue("longitude") ?: return@mapNotNull null
            val name = value.stringValue("name")
                ?: value.stringValue("clientName")
                ?: value.stringValue("cliente")
                ?: return@mapNotNull null

            CustomerEntity(
                id = value.longValue("id") ?: child.key?.toLongOrNull() ?: 0,
                name = name,
                address = value.stringValue("address"),
                city = value.stringValue("city"),
                state = value.stringValue("state"),
                latitude = latitude,
                longitude = longitude,
                phone = value.stringValue("phone"),
                segment = value.stringValue("segment"),
                status = value.stringValue("status"),
                notes = value.stringValue("notes"),
                importedAt = value.longValue("importedAt") ?: System.currentTimeMillis(),
                active = value.booleanValue("active") ?: true,
                opportunity = value.stringValue("opportunity"),
                cnpjCpf = value.stringValue("cnpjCpf"),
                externalId = value.stringValue("externalId"),
                email = value.stringValue("email"),
                responsavel = value.stringValue("responsavel"),
                ultimaAtualizacao = value.stringValue("ultimaAtualizacao"),
                distributor = value.stringValue("distributor"),
                responsableSalesperson = value.stringValue("responsableSalesperson"),
                tags = value.stringValue("tags"),
                expectedRevenue = value.stringValue("expectedRevenue"),
                origem = value.stringValue("origem"),
                pipelineStage = value.stringValue("pipelineStage"),
                clientName = value.stringValue("clientName"),
                country = value.stringValue("country")
            )
        }
    }

    suspend fun publishRoute(routeId: Long, route: PlannedRouteEntity, stops: List<PlannedRouteStopEntity>) {
        val uid = auth.currentUser?.uid ?: return
        val routeKey = routeId.toString()
        val updates = mutableMapOf<String, Any?>(
            "plannedRoutes/$routeKey/id" to routeId,
            "plannedRoutes/$routeKey/name" to route.name,
            "plannedRoutes/$routeKey/mainCustomerName" to route.mainCustomerName,
            "plannedRoutes/$routeKey/mainLatitude" to route.mainLatitude,
            "plannedRoutes/$routeKey/mainLongitude" to route.mainLongitude,
            "plannedRoutes/$routeKey/radiusKm" to route.radiusKm,
            "plannedRoutes/$routeKey/createdAt" to route.createdAt,
            "plannedRoutes/$routeKey/sellerUid" to uid,
            "plannedRoutes/$routeKey/updatedAt" to ServerValue.TIMESTAMP
        )

        stops.forEach { stop ->
            val stopKey = stop.customerId.toString()
            updates["plannedRouteStops/$routeKey/$stopKey/routeId"] = routeId
            updates["plannedRouteStops/$routeKey/$stopKey/customerId"] = stop.customerId
            updates["plannedRouteStops/$routeKey/$stopKey/orderIndex"] = stop.orderIndex
            updates["plannedRouteStops/$routeKey/$stopKey/distanceMeters"] = stop.distanceMeters
        }

        database.reference.updateChildren(updates).await()
    }

    private fun Map<*, *>.stringValue(key: String): String? {
        return this[key]?.toString()?.trim()?.takeIf { it.isNotBlank() }
    }

    private fun Map<*, *>.longValue(key: String): Long? {
        return when (val value = this[key]) {
            is Number -> value.toLong()
            is String -> value.toLongOrNull()
            else -> null
        }
    }

    private fun Map<*, *>.doubleValue(key: String): Double? {
        return when (val value = this[key]) {
            is Number -> value.toDouble()
            is String -> value.replace(',', '.').toDoubleOrNull()
            else -> null
        }
    }

    private fun Map<*, *>.booleanValue(key: String): Boolean? {
        return when (val value = this[key]) {
            is Boolean -> value
            is String -> value.equals("true", ignoreCase = true)
            else -> null
        }
    }
}
