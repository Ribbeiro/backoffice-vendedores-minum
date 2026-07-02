package com.xateenergia.vendedoresminum.presentation.screens.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xateenergia.vendedoresminum.data.repository.PlannedRouteRepository
import com.xateenergia.vendedoresminum.domain.model.PlannedRouteSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class HistoryViewModel @Inject constructor(
    plannedRouteRepository: PlannedRouteRepository
) : ViewModel() {
    val state: StateFlow<HistoryUiState> = plannedRouteRepository.observeSummaries()
        .map { HistoryUiState(routes = it) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = HistoryUiState()
        )
}

data class HistoryUiState(
    val routes: List<PlannedRouteSummary> = emptyList()
)

