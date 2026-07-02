package com.xateenergia.vendedoresminum.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.xateenergia.vendedoresminum.data.entities.CustomerEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CustomerDao {
    @Query("SELECT COUNT(*) FROM customers")
    fun observeCount(): Flow<Int>

    @Query(
        """
        SELECT * FROM customers
        WHERE (:query IS NULL OR name LIKE '%' || :query || '%' OR address LIKE '%' || :query || '%' OR city LIKE '%' || :query || '%')
        ORDER BY name COLLATE NOCASE ASC
        """
    )
    fun observeCustomers(query: String?): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): CustomerEntity?

    @Query(
        """
        SELECT * FROM customers
        WHERE latitude BETWEEN :minLatitude AND :maxLatitude
          AND longitude BETWEEN :minLongitude AND :maxLongitude
          AND (:onlyActive = 0 OR active = 1)
          AND (:onlyWithPhone = 0 OR phone IS NOT NULL AND TRIM(phone) != '')
          AND (:segment IS NULL OR segment = :segment)
          AND (:city IS NULL OR city = :city)
          AND (:state IS NULL OR state = :state)
          AND (:status IS NULL OR status = :status)
        """
    )
    suspend fun getCandidatesInBoundingBox(
        minLatitude: Double,
        maxLatitude: Double,
        minLongitude: Double,
        maxLongitude: Double,
        onlyActive: Boolean,
        onlyWithPhone: Boolean,
        segment: String?,
        city: String?,
        state: String?,
        status: String?
    ): List<CustomerEntity>

    @Query("SELECT DISTINCT segment FROM customers WHERE segment IS NOT NULL AND TRIM(segment) != '' ORDER BY segment")
    fun observeSegments(): Flow<List<String>>

    @Query("SELECT DISTINCT city FROM customers WHERE city IS NOT NULL AND TRIM(city) != '' ORDER BY city")
    fun observeCities(): Flow<List<String>>

    @Query("SELECT DISTINCT state FROM customers WHERE state IS NOT NULL AND TRIM(state) != '' ORDER BY state")
    fun observeStates(): Flow<List<String>>

    @Query("SELECT DISTINCT status FROM customers WHERE status IS NOT NULL AND TRIM(status) != '' ORDER BY status")
    fun observeStatuses(): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(customers: List<CustomerEntity>): List<Long>

    @Query("DELETE FROM customers")
    suspend fun deleteAll()
}

