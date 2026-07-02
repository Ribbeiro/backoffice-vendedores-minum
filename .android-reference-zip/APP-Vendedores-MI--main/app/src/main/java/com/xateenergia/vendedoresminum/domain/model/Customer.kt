package com.xateenergia.vendedoresminum.domain.model

data class Customer(
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
    // Propriedades calculadas para uso na UI
    val fullAddress: String
        get() = listOfNotNull(address, city, state)
            .filter { it.isNotBlank() }
            .joinToString(", ")

    val coordinate: Coordinate
        get() = Coordinate(latitude, longitude)
}