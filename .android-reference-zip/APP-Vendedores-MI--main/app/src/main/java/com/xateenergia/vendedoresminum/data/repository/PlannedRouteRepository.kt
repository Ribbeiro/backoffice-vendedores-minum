package com.xateenergia.vendedoresminum.data.repository

import com.xateenergia.vendedoresminum.data.dao.PlannedRouteDao
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteEntity
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteStopEntity
import com.xateenergia.vendedoresminum.data.remote.FirebaseSyncService
import com.xateenergia.vendedoresminum.domain.model.PlannedRouteSummary
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

@Singleton
class PlannedRouteRepository @Inject constructor(
    private val plannedRouteDao: PlannedRouteDao,
    private val firebaseSyncService: FirebaseSyncService
) {
    fun observeSummaries(): Flow<List<PlannedRouteSummary>> = plannedRouteDao.observeSummaries()

    suspend fun saveRoute(route: PlannedRouteEntity, stops: List<PlannedRouteStopEntity>): Long {
        val routeId = plannedRouteDao.saveRoute(route, stops)
        runCatching {
            firebaseSyncService.publishRoute(routeId, route, stops.map { it.copy(routeId = routeId) })
        }
        return routeId
    }

    suspend fun deleteAll() {
        plannedRouteDao.deleteAll()
    }
}

