package com.xateenergia.vendedoresminum.presentation.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xateenergia.vendedoresminum.data.repository.CustomerRepository
import com.xateenergia.vendedoresminum.data.repository.PlannedRouteRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class HomeViewModel @Inject constructor(
    customerRepository: CustomerRepository,
    plannedRouteRepository: PlannedRouteRepository
) : ViewModel() {
    val state: StateFlow<HomeUiState> = kotlinx.coroutines.flow.combine(
        customerRepository.observeCount(),
        plannedRouteRepository.observeSummaries().map { it.size }
    ) { customerCount, routeCount ->
        HomeUiState(customerCount = customerCount, plannedRoutesCount = routeCount)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = HomeUiState()
    )
}

data class HomeUiState(
    val customerCount: Int = 0,
    val plannedRoutesCount: Int = 0
)

