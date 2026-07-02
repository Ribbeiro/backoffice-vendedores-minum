package com.xateenergia.vendedoresminum.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteEntity
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteStopEntity
import com.xateenergia.vendedoresminum.domain.model.PlannedRouteSummary
import kotlinx.coroutines.flow.Flow

@Dao
interface PlannedRouteDao {
    @Query(
        """
        SELECT planned_routes.id AS id,
               planned_routes.name AS name,
               planned_routes.mainCustomerName AS mainCustomerName,
               planned_routes.mainLatitude AS mainLatitude,
               planned_routes.mainLongitude AS mainLongitude,
               planned_routes.radiusKm AS radiusKm,
               planned_routes.createdAt AS createdAt,
               COUNT(planned_route_stops.customerId) AS stopCount
        FROM planned_routes
        LEFT JOIN planned_route_stops ON planned_routes.id = planned_route_stops.routeId
        GROUP BY planned_routes.id
        ORDER BY planned_routes.createdAt DESC
        """
    )
    fun observeSummaries(): Flow<List<PlannedRouteSummary>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRoute(route: PlannedRouteEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertStops(stops: List<PlannedRouteStopEntity>)

    @Transaction
    suspend fun saveRoute(route: PlannedRouteEntity, stops: List<PlannedRouteStopEntity>): Long {
        val routeId = insertRoute(route)
        insertStops(stops.map { it.copy(routeId = routeId) })
        return routeId
    }

    @Query("DELETE FROM planned_routes")
    suspend fun deleteAll()
}

