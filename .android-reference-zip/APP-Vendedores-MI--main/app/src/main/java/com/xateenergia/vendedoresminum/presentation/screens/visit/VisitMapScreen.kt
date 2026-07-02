package com.xateenergia.vendedoresminum.presentation.screens.visit

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapType
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.xateenergia.vendedoresminum.domain.model.Coordinate
import com.xateenergia.vendedoresminum.domain.model.Customer
import com.xateenergia.vendedoresminum.presentation.components.AppScaffold
import com.xateenergia.vendedoresminum.presentation.components.EmptyState
import com.xateenergia.vendedoresminum.presentation.components.NearbyCustomerCard
import com.xateenergia.vendedoresminum.presentation.utils.ExternalIntents
import com.xateenergia.vendedoresminum.utils.Formatters

@Composable
fun VisitMapScreen(
    onBack: () -> Unit,
    onCustomerClick: (Long) -> Unit,
    viewModel: VisitPlanningViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    var showCustomerPicker by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) {
            viewModel.useCurrentLocation()
        }
    }

    LaunchedEffect(state.message) {
        val message = state.message
        if (message != null) {
            snackbarHostState.showSnackbar(message)
            viewModel.clearMessage()
        }
    }

    // ===== REMOVIDO: LaunchedEffect que escutava navigationEvents =====

    AppScaffold(title = "Mapa de visita", onBack = onBack) { padding ->
        androidx.compose.material3.Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            containerColor = MaterialTheme.colorScheme.background
        ) { innerPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(innerPadding)
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                ProspectPanel(
                    state = state,
                    onLatitudeChange = viewModel::setManualLatitude,
                    onLongitudeChange = viewModel::setManualLongitude,
                    onApplyCoordinate = viewModel::applyManualCoordinate,
                    onAddressChange = viewModel::setAddressQuery,
                    onSearchAddress = viewModel::searchAddress,
                    onUseCurrentLocation = {
                        val hasFine = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        ) == PackageManager.PERMISSION_GRANTED
                        val hasCoarse = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        ) == PackageManager.PERMISSION_GRANTED
                        if (hasFine || hasCoarse) {
                            viewModel.useCurrentLocation()
                        } else {
                            permissionLauncher.launch(
                                arrayOf(
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION
                                )
                            )
                        }
                    },
                    onPickCustomer = { showCustomerPicker = true }
                )

                FilterPanel(
                    state = state,
                    onRadiusChange = viewModel::setRadiusKm,
                    onSegmentChange = viewModel::setSegment,
                    onCityChange = viewModel::setCity,
                    onStateChange = viewModel::setState,
                    onStatusChange = viewModel::setStatus,
                    onOnlyWithPhoneChange = viewModel::setOnlyWithPhone,
                    onOnlyActiveChange = viewModel::setOnlyActive
                )

                VisitMap(
                    state = state,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    onMapClick = viewModel::setMapSelectedOrigin,
                    onMarkerClick = onCustomerClick
                )

                ResultHeader(
                    state = state,
                    onSelectAll = viewModel::selectAllNearby,
                    onClearSelection = viewModel::clearSelection,
                    onOptimize = viewModel::optimizeRoute,
                    onSave = viewModel::saveRoute
                )

                if (state.nearbyCustomers.isEmpty()) {
                    EmptyState(
                        title = if (state.origin == null) "Defina o prospecto" else "Nenhum cliente no raio",
                        message = if (state.origin == null) {
                            "Use coordenadas, endereço, mapa, localização atual ou cliente existente."
                        } else {
                            "Aumente o raio ou ajuste os filtros."
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(120.dp)
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 260.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(state.nearbyCustomers, key = { it.customer.id }) { item ->
                            NearbyCustomerCard(
                                item = item,
                                isSelected = item.customer.id in state.selectedCustomerIds,
                                onSelectedChange = { viewModel.toggleCustomerSelection(item.customer.id) },
                                onDetailsClick = { onCustomerClick(item.customer.id) },
                                onCallClick = { ExternalIntents.dial(context, item.customer.phone) },
                                onNavigateClick = { ExternalIntents.navigate(context, item.customer.coordinate) }
                            )
                        }
                    }
                }
            }
        }
    }

    if (showCustomerPicker) {
        CustomerPickerDialog(
            query = state.customerSearchQuery,
            customers = state.customerSuggestions,
            onQueryChange = viewModel::setCustomerSearchQuery,
            onDismiss = { showCustomerPicker = false },
            onSelect = { customer ->
                viewModel.selectCustomerAsOrigin(customer)
                showCustomerPicker = false
            }
        )
    }
}

@Composable
private fun ProspectPanel(
    state: VisitUiState,
    onLatitudeChange: (String) -> Unit,
    onLongitudeChange: (String) -> Unit,
    onApplyCoordinate: () -> Unit,
    onAddressChange: (String) -> Unit,
    onSearchAddress: () -> Unit,
    onUseCurrentLocation: () -> Unit,
    onPickCustomer: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = state.originLabel,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = state.manualLatitude,
                    onValueChange = onLatitudeChange,
                    label = { Text("Latitude") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = state.manualLongitude,
                    onValueChange = onLongitudeChange,
                    label = { Text("Longitude") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = onApplyCoordinate) {
                    Icon(Icons.Default.LocationOn, contentDescription = "Aplicar coordenadas")
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = state.addressQuery,
                    onValueChange = onAddressChange,
                    label = { Text("Buscar endereço") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = onSearchAddress,
                    enabled = !state.isGeocoding
                ) {
                    if (state.isGeocoding) {
                        CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Search, contentDescription = "Buscar endereço")
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = onUseCurrentLocation,
                    enabled = !state.isLocating,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.MyLocation, contentDescription = null)
                    Text(if (state.isLocating) "Localizando" else "Atual")
                }
                OutlinedButton(
                    onClick = onPickCustomer,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.UploadFile, contentDescription = null)
                    Text("Cliente base")
                }
            }
        }
    }
}

@Composable
private fun FilterPanel(
    state: VisitUiState,
    onRadiusChange: (Double) -> Unit,
    onSegmentChange: (String?) -> Unit,
    onCityChange: (String?) -> Unit,
    onStateChange: (String?) -> Unit,
    onStatusChange: (String?) -> Unit,
    onOnlyWithPhoneChange: (Boolean) -> Unit,
    onOnlyActiveChange: (Boolean) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Default.FilterAlt, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
                Text("Filtros", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }

            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(1.0, 2.0, 5.0, 10.0, 20.0).forEach { radius ->
                    FilterChip(
                        selected = state.radiusKm == radius,
                        onClick = { onRadiusChange(radius) },
                        label = { Text("${radius.toInt()} km") }
                    )
                }
            }

            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterDropdown("Segmento", state.segment, state.filterOptions.segments, onSegmentChange)
                FilterDropdown("Cidade", state.city, state.filterOptions.cities, onCityChange)
                FilterDropdown("Estado", state.stateUf, state.filterOptions.states, onStateChange)
                FilterDropdown("Status", state.status, state.filterOptions.statuses, onStatusChange)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Somente com telefone", style = MaterialTheme.typography.bodyMedium)
                Switch(checked = state.onlyWithPhone, onCheckedChange = onOnlyWithPhoneChange)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Somente ativos", style = MaterialTheme.typography.bodyMedium)
                Switch(checked = state.onlyActive, onCheckedChange = onOnlyActiveChange)
            }
        }
    }
}

@Composable
private fun FilterDropdown(
    label: String,
    selected: String?,
    options: List<String>,
    onSelect: (String?) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }) {
            Text(selected ?: label, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("Todos") },
                onClick = {
                    onSelect(null)
                    expanded = false
                }
            )
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    }
                )
            }
        }
    }
}

@Composable
private fun VisitMap(
    state: VisitUiState,
    modifier: Modifier,
    onMapClick: (Coordinate) -> Unit,
    onMarkerClick: (Long) -> Unit
) {
    val fallbackPosition = LatLng(-23.5505, -46.6333)
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(fallbackPosition, 11f)
    }

    LaunchedEffect(state.origin) {
        val origin = state.origin
        if (origin != null) {
            cameraPositionState.animate(
                CameraUpdateFactory.newLatLngZoom(LatLng(origin.latitude, origin.longitude), 13.5f)
            )
        }
    }

    val selectedRoutePoints = state.optimizedStops.map {
        LatLng(it.customer.latitude, it.customer.longitude)
    }
    val originPoint = state.origin?.let { LatLng(it.latitude, it.longitude) }
    val linePoints = if (originPoint != null && selectedRoutePoints.isNotEmpty()) {
        listOf(originPoint) + selectedRoutePoints
    } else {
        emptyList()
    }

    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium
    ) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            properties = MapProperties(
                mapType = if (state.mapMode == "SATELLITE") MapType.SATELLITE else MapType.NORMAL
            ),
            uiSettings = MapUiSettings(
                zoomControlsEnabled = false,
                myLocationButtonEnabled = false
            ),
            onMapClick = { latLng ->
                onMapClick(Coordinate(latLng.latitude, latLng.longitude))
            }
        ) {
            if (originPoint != null) {
                Marker(
                    state = MarkerState(position = originPoint),
                    title = state.originLabel,
                    snippet = "Prospecto principal",
                    icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_RED)
                )
            }

            state.nearbyCustomers.forEach { item ->
                val selected = item.customer.id in state.selectedCustomerIds
                Marker(
                    state = MarkerState(position = LatLng(item.customer.latitude, item.customer.longitude)),
                    title = item.customer.name,
                    snippet = Formatters.distance(item.distanceMeters),
                    icon = BitmapDescriptorFactory.defaultMarker(
                        if (selected) BitmapDescriptorFactory.HUE_AZURE else BitmapDescriptorFactory.HUE_GREEN
                    ),
                    onClick = {
                        onMarkerClick(item.customer.id)
                        true
                    }
                )
            }

            if (linePoints.size > 1) {
                Polyline(
                    points = linePoints,
                    color = Color(0xFF146C5F),
                    width = 8f
                )
            }
        }
    }
}

@Composable
private fun ResultHeader(
    state: VisitUiState,
    onSelectAll: () -> Unit,
    onClearSelection: () -> Unit,
    onOptimize: () -> Unit,
    onSave: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = "${state.nearbyCustomers.size} clientes próximos",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "${state.selectedCustomerIds.size} selecionados",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (state.isSearching) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
            }
        }

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            AssistChip(onClick = onSelectAll, leadingIcon = { Icon(Icons.Default.SelectAll, null) }, label = { Text("Selecionar") })
            AssistChip(onClick = onClearSelection, label = { Text("Limpar") })
            AssistChip(onClick = onOptimize, leadingIcon = { Icon(Icons.Default.Route, null) }, label = { Text("Otimizar") })
            Button(onClick = onSave, enabled = state.selectedCustomerIds.isNotEmpty() && !state.isSaving) {
                Text(if (state.isSaving) "Salvando" else "Salvar rota")
            }
        }
    }
}

@Composable
private fun CustomerPickerDialog(
    query: String,
    customers: List<Customer>,
    onQueryChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onSelect: (Customer) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Selecionar cliente principal") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    label = { Text("Buscar cliente") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                LazyColumn(
                    modifier = Modifier.heightIn(max = 360.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(customers, key = { it.id }) { customer ->
                        TextButton(
                            onClick = { onSelect(customer) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalAlignment = Alignment.Start
                            ) {
                                Text(customer.name, fontWeight = FontWeight.SemiBold)
                                if (customer.fullAddress.isNotBlank()) {
                                    Text(
                                        customer.fullAddress,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Fechar")
            }
        }
    )
}