package com.xateenergia.vendedoresminum.presentation.screens.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Directions
import androidx.compose.material.icons.filled.Map
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.xateenergia.vendedoresminum.domain.model.Customer
import com.xateenergia.vendedoresminum.presentation.components.AppScaffold
import com.xateenergia.vendedoresminum.presentation.components.EmptyState
import com.xateenergia.vendedoresminum.presentation.components.LoadingState
import com.xateenergia.vendedoresminum.presentation.utils.ExternalIntents

@Composable
fun CustomerDetailScreen(
    customerId: Long,
    onBack: () -> Unit,
    viewModel: CustomerDetailViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(customerId) {
        viewModel.load(customerId)
    }

    AppScaffold(
        title = "Detalhes do cliente",
        onBack = onBack
    ) { padding ->
        when {
            state.isLoading -> LoadingState(
                message = "Carregando cliente...",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            )

            state.customer == null -> EmptyState(
                title = "Cliente indisponível",
                message = state.error ?: "Não foi possível carregar este cadastro.",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            )

            else -> {
                val customer = state.customer!!
                CustomerDetailsContent(
                    customer = customer,
                    onCall = { ExternalIntents.dial(context, customer.phone) },
                    onOpenMap = { ExternalIntents.openMap(context, customer.coordinate, customer.name) },
                    onNavigate = { ExternalIntents.navigate(context, customer.coordinate) },
                    modifier = Modifier.padding(padding)
                )
            }
        }
    }
}

@Composable
private fun CustomerDetailsContent(
    customer: Customer,
    onCall: () -> Unit,
    onOpenMap: () -> Unit,
    onNavigate: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Card(shape = MaterialTheme.shapes.medium) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Nome principal (Opportunity)
                Text(
                    text = customer.name.ifBlank { "Nome não informado" },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )

                // Client - Name (se existir e for diferente)
                if (!customer.clientName.isNullOrBlank() && customer.clientName != customer.name) {
                    DetailLine("Cliente (original)", customer.clientName)
                }

                Divider()

                // ===== INFORMAÇÕES GERAIS =====
                SectionTitle("Informações gerais")
                DetailLine("Oportunidade", customer.opportunity)
                DetailLine("CNPJ/CPF", customer.cnpjCpf)
                DetailLine("ID externo", customer.externalId)
                DetailLine("E-mail", customer.email)
                DetailLine("Telefone", customer.phone)
                DetailLine("Segmento", customer.segment)
                DetailLine("Status", if (customer.active) "Ativo" else "Inativo")
                DetailLine("País", customer.country)

                Divider()

                // ===== ENDEREÇO =====
                SectionTitle("Endereço")
                DetailLine("Logradouro", customer.address)
                DetailLine("Cidade", customer.city)
                DetailLine("Estado", customer.state)
                DetailLine("Latitude", customer.latitude.toString())
                DetailLine("Longitude", customer.longitude.toString())

                Divider()

                // ===== COMERCIAL =====
                SectionTitle("Comercial")
                DetailLine("Responsável", customer.responsavel)
                DetailLine("Vendedor", customer.responsableSalesperson)
                DetailLine("Distribuidor", customer.distributor)
                DetailLine("Estágio", customer.pipelineStage)
                DetailLine("Origem", customer.origem)
                DetailLine("Tags", customer.tags)
                DetailLine("Receita esperada", customer.expectedRevenue)

                Divider()

                // ===== OBSERVAÇÕES =====
                SectionTitle("Observações")
                // Deal - Notes
                if (!customer.notes.isNullOrBlank()) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = "Notas",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = customer.notes,
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                } else {
                    DetailLine("Notas", "Nenhuma observação")
                }
                DetailLine("Última atualização", customer.ultimaAtualizacao)
            }
        }

        // Botões
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedButton(
                onClick = onCall,
                enabled = !customer.phone.isNullOrBlank(),
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.Call, contentDescription = null)
                Text("Ligar")
            }
            OutlinedButton(
                onClick = onOpenMap,
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.Map, contentDescription = null)
                Text("Mapa")
            }
        }

        Button(
            onClick = onNavigate,
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Default.Directions, contentDescription = null)
            Text("Iniciar navegação")
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold
    )
}

@Composable
private fun DetailLine(label: String, value: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value?.ifBlank { "Não informado" } ?: "Não informado",
            style = MaterialTheme.typography.bodyLarge
        )
    }
}