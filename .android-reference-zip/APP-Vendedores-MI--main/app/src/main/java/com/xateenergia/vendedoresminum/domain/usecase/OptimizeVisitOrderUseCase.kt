package com.xateenergia.vendedoresminum.domain.usecase

import com.xateenergia.vendedoresminum.domain.model.Coordinate
import com.xateenergia.vendedoresminum.domain.model.NearbyCustomer
import com.xateenergia.vendedoresminum.utils.GeoUtils
import javax.inject.Inject

class OptimizeVisitOrderUseCase @Inject constructor() {
    operator fun invoke(origin: Coordinate, selectedCustomers: List<NearbyCustomer>): List<NearbyCustomer> {
        val remaining = selectedCustomers.toMutableList()
        val ordered = mutableListOf<NearbyCustomer>()
        var current = origin

        while (remaining.isNotEmpty()) {
            val next = remaining.minBy { candidate ->
                GeoUtils.haversineDistanceMeters(current, candidate.customer.coordinate)
            }
            remaining.remove(next)
            ordered += next.copy(routeOrder = ordered.size + 1)
            current = next.customer.coordinate
        }

        return ordered
    }
}

