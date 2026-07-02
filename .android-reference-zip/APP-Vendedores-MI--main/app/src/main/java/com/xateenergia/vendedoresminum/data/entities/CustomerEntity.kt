package com.xateenergia.vendedoresminum.data.entities

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.xateenergia.vendedoresminum.domain.model.Customer
import com.xateenergia.vendedoresminum.domain.model.Coordinate

@Entity(
    tableName = "customers",
    indices = [
        Index("latitude", "longitude"),
        Index("city"),
        Index("state"),
        Index("segment"),
        Index("status"),
        Index("email"),
        Index("cnpjCpf")
    ]
)
data class CustomerEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val address: String? = null,
    val city: String? = null,
    val state: String? = null,
    val latitude: Double,
    val longitude: Double,
    val phone: String? = null,
    val segment: String? = null,
    val status: String? = null,
    val notes: String? = null,
    val importedAt: Long = System.currentTimeMillis(),
    val active: Boolean = true,
    // Novos campos
    val opportunity: String? = null,
    val cnpjCpf: String? = null,
    val externalId: String? = null,
    val email: String? = null,
    val responsavel: String? = null,
    val ultimaAtualizacao: String? = null,
    val distributor: String? = null,
    val responsableSalesperson: String? = null,
    val tags: String? = null,
    val expectedRevenue: String? = null,
    val origem: String? = null,
    val pipelineStage: String? = null,
    val clientName: String? = null,
    val country: String? = null
) {
    fun toDomain(): Customer {
        return Customer(
            id = id,
            name = name,
            address = address,
            city = city,
            state = state,
            latitude = latitude,
            longitude = longitude,
            phone = phone,
            segment = segment,
            status = status,
            notes = notes,
            importedAt = importedAt,
            active = active,
            opportunity = opportunity,
            cnpjCpf = cnpjCpf,
            externalId = externalId,
            email = email,
            responsavel = responsavel,
            ultimaAtualizacao = ultimaAtualizacao,
            distributor = distributor,
            responsableSalesperson = responsableSalesperson,
            tags = tags,
            expectedRevenue = expectedRevenue,
            origem = origem,
            pipelineStage = pipelineStage,
            clientName = clientName,
            country = country
        )
    }
}