package com.xateenergia.vendedoresminum.presentation.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.xateenergia.vendedoresminum.presentation.components.AppScaffold

@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showConfirmClear by remember { mutableStateOf(false) }

    LaunchedEffect(state.message) {
        val message = state.message
        if (message != null) {
            snackbarHostState.showSnackbar(message)
            viewModel.clearMessage()
        }
    }

    AppScaffold(title = "Configurações", onBack = onBack) { padding ->
        androidx.compose.material3.Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            containerColor = MaterialTheme.colorScheme.background
        ) { innerPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(innerPadding)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                SettingsCard(title = "Raio padrão") {
                    Text(
                        text = "Usado ao iniciar uma nova visita.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(1.0, 2.0, 5.0, 10.0, 20.0).forEach { radius ->
                            FilterChip(
                                selected = state.defaultRadiusKm == radius,
                                onClick = { viewModel.setDefaultRadius(radius) },
                                label = { Text("${radius.toInt()} km") }
                            )
                        }
                    }
                }

                SettingsCard(title = "Mapa") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        mapOf("NORMAL" to "Padrão", "SATELLITE" to "Satélite").forEach { (mode, label) ->
                            FilterChip(
                                selected = state.mapMode == mode,
                                onClick = { viewModel.setMapMode(mode) },
                                label = { Text(label) }
                            )
                        }
                    }
                }

                SettingsCard(title = "Filtros") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Clientes ativos por padrão", fontWeight = FontWeight.SemiBold)
                            Text(
                                text = "Oculta cadastros marcados como inativos.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = state.onlyActiveByDefault,
                            onCheckedChange = viewModel::setOnlyActiveByDefault
                        )
                    }
                }

                SettingsCard(title = "Dados locais") {
                    OutlinedButton(
                        onClick = { showConfirmClear = true },
                        enabled = !state.isClearing,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null)
                        Text("Limpar clientes e histórico")
                    }
                }
            }
        }
    }

    if (showConfirmClear) {
        AlertDialog(
            onDismissRequest = { showConfirmClear = false },
            title = { Text("Limpar dados locais?") },
            text = { Text("Clientes importados e rotas planejadas serão removidos deste aparelho.") },
            confirmButton = {
                Button(
                    onClick = {
                        showConfirmClear = false
                        viewModel.clearAllData()
                    }
                ) {
                    Text("Limpar")
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmClear = false }) {
                    Text("Cancelar")
                }
            }
        )
    }
}

@Composable
private fun SettingsCard(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}
