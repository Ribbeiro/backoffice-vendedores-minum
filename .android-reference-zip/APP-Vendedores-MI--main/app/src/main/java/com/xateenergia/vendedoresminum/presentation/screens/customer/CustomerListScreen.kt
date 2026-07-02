package com.xateenergia.vendedoresminum.presentation.screens.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.xateenergia.vendedoresminum.presentation.components.AppScaffold
import com.xateenergia.vendedoresminum.presentation.components.CustomerListCard
import com.xateenergia.vendedoresminum.presentation.components.EmptyState

@Composable
fun CustomerListScreen(
    onBack: () -> Unit,
    onCustomerClick: (Long) -> Unit,
    viewModel: CustomerListViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()

    AppScaffold(
        title = "Clientes",
        onBack = onBack
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::setQuery,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                label = { Text("Buscar cliente, endereço ou cidade") }
            )

            if (state.customers.isEmpty()) {
                EmptyState(
                    title = "Nenhum cliente encontrado",
                    message = "Importe uma planilha ou ajuste a busca.",
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Text(
                    text = "${state.customers.size} clientes",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(state.customers, key = { it.id }) { customer ->
                        CustomerListCard(
                            customer = customer,
                            onClick = { onCustomerClick(customer.id) }
                        )
                    }
                }
            }
        }
    }
}

