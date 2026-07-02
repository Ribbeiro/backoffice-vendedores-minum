package com.xateenergia.vendedoresminum.data.repository

import com.xateenergia.vendedoresminum.data.dao.PlannedRouteDao
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteEntity
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteStopEntity
import com.xateenergia.vendedoresminum.domain.model.PlannedRouteSummary
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

@Singleton
class PlannedRouteRepository @Inject constructor(
    private val plannedRouteDao: PlannedRouteDao
) {
    fun observeSummaries(): Flow<List<PlannedRouteSummary>> = plannedRouteDao.observeSummaries()

    suspend fun saveRoute(route: PlannedRouteEntity, stops: List<PlannedRouteStopEntity>): Long {
        return plannedRouteDao.saveRoute(route, stops)
    }

    suspend fun deleteAll() {
        plannedRouteDao.deleteAll()
    }
}

