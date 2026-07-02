package com.xateenergia.vendedoresminum.domain.usecase

import com.xateenergia.vendedoresminum.data.repository.CustomerRepository
import com.xateenergia.vendedoresminum.domain.model.Coordinate
import com.xateenergia.vendedoresminum.domain.model.CustomerFilters
import com.xateenergia.vendedoresminum.domain.model.NearbyCustomer
import com.xateenergia.vendedoresminum.utils.GeoUtils
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class FindNearbyCustomersUseCase @Inject constructor(
    private val customerRepository: CustomerRepository
) {
    suspend operator fun invoke(origin: Coordinate, filters: CustomerFilters): List<NearbyCustomer> {
        return withContext(Dispatchers.Default) {
            val box = GeoUtils.boundingBox(origin, filters.radiusKm)
            customerRepository.getCandidates(box, filters)
                .asSequence()
                .map { customer ->
                    NearbyCustomer(
                        customer = customer,
                        distanceMeters = GeoUtils.haversineDistanceMeters(origin, customer.coordinate)
                    )
                }
                .filter { it.distanceMeters <= filters.radiusMeters }
                .sortedBy { it.distanceMeters }
                .toList()
        }
    }
}

