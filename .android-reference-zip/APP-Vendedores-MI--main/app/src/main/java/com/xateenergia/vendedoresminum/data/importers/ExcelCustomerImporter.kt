package com.xateenergia.vendedoresminum.data.importers

import android.util.Log
import com.xateenergia.vendedoresminum.data.entities.CustomerEntity
import com.xateenergia.vendedoresminum.utils.GeoUtils
import com.xateenergia.vendedoresminum.utils.TextNormalizer
import java.io.InputStream
import java.util.Locale
import javax.inject.Inject
import org.apache.poi.ss.usermodel.DataFormatter
import org.apache.poi.ss.usermodel.Row
import org.apache.poi.ss.usermodel.WorkbookFactory

class ExcelCustomerImporter @Inject constructor() {
    private val formatter = DataFormatter(Locale("pt", "BR"))
    private val tag = "ExcelImporter"

    fun import(inputStream: InputStream): ExcelImportResult {
        WorkbookFactory.create(inputStream).use { workbook ->
            if (workbook.numberOfSheets == 0) {
                throw IllegalArgumentException("A planilha não possui abas.")
            }

            val sheet = workbook.getSheetAt(0)
            val headerRow = findHeaderRow(sheet.iterator())
                ?: throw IllegalArgumentException("Não foi possível identificar o cabeçalho da planilha.")

            val columns = detectColumns(headerRow)

            // LOG: colunas detectadas
            Log.d(tag, "Colunas detectadas: $columns")

            val hasLatLngColumns = columns.latitude != null && columns.longitude != null
            if (!hasLatLngColumns && columns.notes == null) {
                throw IllegalArgumentException("A planilha precisa ter colunas de latitude e longitude, ou um campo de observações com coordenadas.")
            }

            val importedAt = System.currentTimeMillis()
            val customers = mutableListOf<CustomerEntity>()
            val failures = mutableListOf<String>()
            var ignored = 0

            for (rowIndex in (headerRow.rowNum + 1)..sheet.lastRowNum) {
                val row = sheet.getRow(rowIndex)
                if (row == null || row.isEmpty()) {
                    ignored++
                    continue
                }

                var latitude = row.parseDouble(columns.latitude)
                var longitude = row.parseDouble(columns.longitude)

                if (latitude == null || longitude == null) {
                    val notesText = row.text(columns.notes) ?: ""
                    val coords = extractCoordinates(notesText)
                    if (coords != null) {
                        latitude = coords.first
                        longitude = coords.second
                    }
                }

                if (latitude == null || longitude == null || !GeoUtils.isValidCoordinate(latitude, longitude)) {
                    failures += "Linha ${row.rowNum + 1}: latitude/longitude inválidas."
                    continue
                }

                val status = row.text(columns.status) ?: "Ativo"

                // ===== EXTRAÇÃO DOS DADOS =====
                val opportunity = row.text(columns.opportunity)
                val clientName = row.text(columns.clientName)
                val name = opportunity ?: clientName ?: row.text(columns.name) ?: "Cliente linha ${row.rowNum + 1}"
                val address = row.text(columns.address) ?: ""
                val city = row.text(columns.city) ?: ""
                val state = row.text(columns.state) ?: ""
                val phone = row.text(columns.phone)?.replace(Regex("[^\\d+]"), "") ?: ""
                val segment = row.text(columns.segment) ?: ""
                val notes = row.text(columns.notes) ?: ""
                val cnpjCpf = row.text(columns.cnpjCpf) ?: ""
                val externalId = row.text(columns.externalId) ?: ""
                val email = row.text(columns.email) ?: ""
                val responsavel = row.text(columns.responsavel) ?: ""
                val ultimaAtualizacao = row.text(columns.ultimaAtualizacao) ?: ""
                val distributor = row.text(columns.distributor) ?: ""
                val responsableSalesperson = row.text(columns.responsableSalesperson) ?: ""
                val tags = row.text(columns.tags) ?: ""
                val expectedRevenue = row.text(columns.expectedRevenue) ?: ""
                val origem = row.text(columns.origem) ?: ""
                val pipelineStage = row.text(columns.pipelineStage) ?: ""
                val country = row.text(columns.country) ?: ""

                // LOG dos valores lidos
                Log.d(tag, "Linha ${row.rowNum + 1}:")
                Log.d(tag, "  name=$name, opportunity=$opportunity, clientName=$clientName")
                Log.d(tag, "  phone=$phone, email=$email, expectedRevenue=$expectedRevenue")
                Log.d(tag, "  notes=${notes.take(50)}...")

                customers += CustomerEntity(
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
                    active = status.isActiveStatus(),
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

            return ExcelImportResult(
                customers = customers,
                failedCount = failures.size,
                ignoredCount = ignored,
                failureSamples = failures.take(8)
            )
        }
    }

    private fun findHeaderRow(rows: Iterator<Row>): Row? {
        return rows.asSequence()
            .take(15)
            .firstOrNull { row ->
                val headers = row.map { TextNormalizer.normalizeHeader(formatter.formatCellValue(it)) }
                headers.any { it in latitudeHeaders } && headers.any { it in longitudeHeaders } ||
                        headers.any { it in notesHeaders }
            }
    }

    private fun detectColumns(row: Row): CustomerColumns {
        val result = MutableCustomerColumns()
        row.forEach { cell ->
            val header = TextNormalizer.normalizeHeader(formatter.formatCellValue(cell))
            val index = cell.columnIndex
            when {
                header in nameHeaders -> result.name = index
                header in addressHeaders -> result.address = index
                header in cityHeaders -> result.city = index
                header in stateHeaders -> result.state = index
                header in latitudeHeaders -> result.latitude = index
                header in longitudeHeaders -> result.longitude = index
                header in phoneHeaders -> result.phone = index
                header in segmentHeaders -> result.segment = index
                header in statusHeaders -> result.status = index
                header in notesHeaders -> result.notes = index
                header in opportunityHeaders -> result.opportunity = index
                header in cnpjCpfHeaders -> result.cnpjCpf = index
                header in externalIdHeaders -> result.externalId = index
                header in emailHeaders -> result.email = index
                header in responsavelHeaders -> result.responsavel = index
                header in ultimaAtualizacaoHeaders -> result.ultimaAtualizacao = index
                header in distributorHeaders -> result.distributor = index
                header in responsableSalespersonHeaders -> result.responsableSalesperson = index
                header in tagsHeaders -> result.tags = index
                header in expectedRevenueHeaders -> result.expectedRevenue = index
                header in origemHeaders -> result.origem = index
                header in pipelineStageHeaders -> result.pipelineStage = index
                header in clientNameHeaders -> result.clientName = index
                header in countryHeaders -> result.country = index
            }
        }
        return result.toImmutable()
    }

    private fun Row.text(columnIndex: Int?): String? {
        if (columnIndex == null) return null
        val cell = getCell(columnIndex) ?: return null
        return TextNormalizer.blankToNull(formatter.formatCellValue(cell))
    }

    private fun Row.parseDouble(columnIndex: Int?): Double? {
        if (columnIndex == null) return null
        val cell = getCell(columnIndex) ?: return null
        if (cell.cellType == org.apache.poi.ss.usermodel.CellType.NUMERIC) {
            return cell.numericCellValue
        }
        return formatter.formatCellValue(cell)
            .trim()
            .replace(" ", "")
            .replace(",", ".")
            .toDoubleOrNull()
    }

    private fun Row.isEmpty(): Boolean {
        if (physicalNumberOfCells == 0) return true
        return all { cell -> formatter.formatCellValue(cell).isBlank() }
    }

    private fun String?.isActiveStatus(): Boolean {
        val normalized = TextNormalizer.normalizeHeader(this.orEmpty())
        return normalized !in setOf(
            "inativo",
            "inactive",
            "cancelado",
            "cancelada",
            "bloqueado",
            "nao",
            "n",
            "false",
            "0"
        )
    }

    private fun extractCoordinates(text: String): Pair<Double, Double>? {
        val regex = Regex("""(-?\d+\.\d+)\s*[,;]\s*(-?\d+\.\d+)""")
        val match = regex.find(text)
        if (match != null) {
            val lat = match.groupValues[1].toDoubleOrNull()
            val lon = match.groupValues[2].toDoubleOrNull()
            if (lat != null && lon != null && GeoUtils.isValidCoordinate(lat, lon)) {
                return Pair(lat, lon)
            }
        }
        return null
    }

    private data class MutableCustomerColumns(
        var name: Int? = null,
        var address: Int? = null,
        var city: Int? = null,
        var state: Int? = null,
        var latitude: Int? = null,
        var longitude: Int? = null,
        var phone: Int? = null,
        var segment: Int? = null,
        var status: Int? = null,
        var notes: Int? = null,
        var opportunity: Int? = null,
        var cnpjCpf: Int? = null,
        var externalId: Int? = null,
        var email: Int? = null,
        var responsavel: Int? = null,
        var ultimaAtualizacao: Int? = null,
        var distributor: Int? = null,
        var responsableSalesperson: Int? = null,
        var tags: Int? = null,
        var expectedRevenue: Int? = null,
        var origem: Int? = null,
        var pipelineStage: Int? = null,
        var clientName: Int? = null,
        var country: Int? = null
    ) {
        fun toImmutable(): CustomerColumns = CustomerColumns(
            name, address, city, state, latitude, longitude, phone, segment, status, notes,
            opportunity, cnpjCpf, externalId, email, responsavel, ultimaAtualizacao,
            distributor, responsableSalesperson, tags, expectedRevenue, origem,
            pipelineStage, clientName, country
        )
    }

    companion object {
        // CAMPOS EXISTENTES (com novos sinônimos)
        private val nameHeaders = setOf("nome", "cliente", "razaosocial", "nomecliente", "fantasia", "empresa")
        private val addressHeaders = setOf(
            "endereco", "logradouro", "rua", "address", "enderecocompleto",
            "dealaddress", "deal-address" // NOVO
        )
        private val cityHeaders = setOf("cidade", "municipio", "city")
        private val stateHeaders = setOf(
            "estado", "uf", "state",
            "clientstate", "client-state" // NOVO
        )
        private val latitudeHeaders = setOf("latitude", "lat", "coordlat", "coordenadalatitude")
        private val longitudeHeaders = setOf("longitude", "lng", "lon", "long", "coordlong", "coordenadalongitude")
        private val phoneHeaders = setOf(
            "telefone", "fone", "celular", "whatsapp", "phone", "contato",
            "clientphone", "client-phone"
        )
        private val segmentHeaders = setOf(
            "segmento", "ramo", "categoria", "segment",
            "dealsegment", "deal-segment" // NOVO
        )
        private val statusHeaders = setOf("status", "situacao", "ativo")
        private val notesHeaders = setOf(
            "observacoes", "observacao", "obs", "notas", "notes",
            "dealnotes", "deal-notes" // NOVO
        )

        // NOVOS CAMPOS
        private val opportunityHeaders = setOf("opportunity", "oportunidade")
        private val cnpjCpfHeaders = setOf("cnpj", "cpf", "cpfcnpj", "documento", "cnpjcpf")
        private val externalIdHeaders = setOf("id", "externalid", "identificador")
        private val emailHeaders = setOf("email", "e-mail", "clientemail", "client-email", "clienteemail")
        private val responsavelHeaders = setOf("responsavel", "responsável", "responsable", "owner")
        private val ultimaAtualizacaoHeaders = setOf("ultimaatualizacao", "ultima atualizacao", "dataatualizacao", "updatedat")
        private val distributorHeaders = setOf("distributor", "deal-distributor", "distribuidor")
        private val responsableSalespersonHeaders = setOf("salesperson", "vendedor", "responsablesalesperson", "deal-responsablesalesperson")
        private val tagsHeaders = setOf("tags", "deal-tags", "etiquetas")
        private val expectedRevenueHeaders = setOf("expectedrevenue", "receitaesperada", "expected revenue", "deal-expectedrevenue", "DealExpectedRevenue")
        private val origemHeaders = setOf("origem", "deal-origem", "fonte")
        private val pipelineStageHeaders = setOf("pipeline", "stage", "pipeline-stage", "deal-pipelinestage", "estagio")
        private val clientNameHeaders = setOf("clientname", "client-name", "nomecliente")
        private val countryHeaders = setOf("country", "pais", "país")
    }
}

data class ExcelImportResult(
    val customers: List<CustomerEntity>,
    val failedCount: Int,
    val ignoredCount: Int,
    val failureSamples: List<String>
)

data class CustomerColumns(
    val name: Int?,
    val address: Int?,
    val city: Int?,
    val state: Int?,
    val latitude: Int?,
    val longitude: Int?,
    val phone: Int?,
    val segment: Int?,
    val status: Int?,
    val notes: Int?,
    val opportunity: Int?,
    val cnpjCpf: Int?,
    val externalId: Int?,
    val email: Int?,
    val responsavel: Int?,
    val ultimaAtualizacao: Int?,
    val distributor: Int?,
    val responsableSalesperson: Int?,
    val tags: Int?,
    val expectedRevenue: Int?,
    val origem: Int?,
    val pipelineStage: Int?,
    val clientName: Int?,
    val country: Int?
)