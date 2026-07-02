package com.xateenergia.vendedoresminum.domain.model

data class ImportReport(
    val importedCount: Int,
    val failedCount: Int,
    val ignoredCount: Int,
    val failureSamples: List<String> = emptyList()
)

