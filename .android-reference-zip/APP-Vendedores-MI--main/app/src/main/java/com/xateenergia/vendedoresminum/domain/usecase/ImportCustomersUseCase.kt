package com.xateenergia.vendedoresminum.domain.usecase

import android.content.Context
import android.net.Uri
import com.xateenergia.vendedoresminum.data.importers.ExcelCustomerImporter
import com.xateenergia.vendedoresminum.data.repository.CustomerRepository
import com.xateenergia.vendedoresminum.domain.model.ImportReport
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ImportCustomersUseCase @Inject constructor(
    @ApplicationContext private val context: Context,
    private val importer: ExcelCustomerImporter,
    private val customerRepository: CustomerRepository
) {
    suspend operator fun invoke(uri: Uri, replaceExisting: Boolean): ImportReport = withContext(Dispatchers.IO) {
        val importResult = context.contentResolver.openInputStream(uri)?.use { inputStream ->
            importer.import(inputStream)
        } ?: throw IllegalArgumentException("Não foi possível abrir o arquivo selecionado.")

        val imported = customerRepository.saveImportedCustomers(importResult.customers, replaceExisting)
        ImportReport(
            importedCount = imported,
            failedCount = importResult.failedCount,
            ignoredCount = importResult.ignoredCount,
            failureSamples = importResult.failureSamples
        )
    }
}

