package com.xateenergia.vendedoresminum.data.repository

import androidx.room.withTransaction
import com.xateenergia.vendedoresminum.data.dao.CustomerDao
import com.xateenergia.vendedoresminum.data.database.AppDatabase
import com.xateenergia.vendedoresminum.data.entities.CustomerEntity
import com.xateenergia.vendedoresminum.domain.model.Customer
import com.xateenergia.vendedoresminum.domain.model.CustomerFilters
import com.xateenergia.vendedoresminum.utils.BoundingBox
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

@Singleton
class CustomerRepository @Inject constructor(
    private val database: AppDatabase,
    private val customerDao: CustomerDao
) {
    fun observeCount(): Flow<Int> = customerDao.observeCount()

    fun observeCustomers(query: String?): Flow<List<Customer>> {
        val normalizedQuery = query?.trim()?.takeIf { it.isNotBlank() }
        return customerDao.observeCustomers(normalizedQuery).map { list ->
            list.map { it.toDomain() }
        }
    }

    suspend fun getById(id: Long): Customer? {
        return customerDao.getById(id)?.toDomain()
    }

    suspend fun getCandidates(box: BoundingBox, filters: CustomerFilters): List<Customer> {
        return customerDao.getCandidatesInBoundingBox(
            minLatitude = box.minLatitude,
            maxLatitude = box.maxLatitude,
            minLongitude = box.minLongitude,
            maxLongitude = box.maxLongitude,
            onlyActive = filters.onlyActive,
            onlyWithPhone = filters.onlyWithPhone,
            segment = filters.segment,
            city = filters.city,
            state = filters.state,
            status = filters.status
        ).map { it.toDomain() }
    }

    suspend fun saveImportedCustomers(customers: List<CustomerEntity>, replaceExisting: Boolean): Int {
        if (customers.isEmpty()) return 0
        return database.withTransaction {
            if (replaceExisting) {
                customerDao.deleteAll()
            }
            customerDao.insertAll(customers).size
        }
    }

    suspend fun deleteAll() {
        database.withTransaction {
            customerDao.deleteAll()
        }
    }

    fun observeSegments(): Flow<List<String>> = customerDao.observeSegments()
    fun observeCities(): Flow<List<String>> = customerDao.observeCities()
    fun observeStates(): Flow<List<String>> = customerDao.observeStates()
    fun observeStatuses(): Flow<List<String>> = customerDao.observeStatuses()
}