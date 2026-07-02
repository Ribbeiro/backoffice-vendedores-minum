package com.xateenergia.vendedoresminum.presentation.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xateenergia.vendedoresminum.data.repository.CustomerRepository
import com.xateenergia.vendedoresminum.data.repository.PlannedRouteRepository
import com.xateenergia.vendedoresminum.data.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val customerRepository: CustomerRepository,
    private val plannedRouteRepository: PlannedRouteRepository
) : ViewModel() {
    private val transient = MutableStateFlow(SettingsTransientState())

    val state: StateFlow<SettingsUiState> = combine(
        settingsRepository.defaultRadiusKm,
        settingsRepository.mapMode,
        settingsRepository.onlyActiveByDefault,
        transient
    ) { radius, mapMode, onlyActive, transientState ->
        SettingsUiState(
            defaultRadiusKm = radius,
            mapMode = mapMode,
            onlyActiveByDefault = onlyActive,
            isClearing = transientState.isClearing,
            message = transientState.message
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = SettingsUiState()
    )

    fun setDefaultRadius(radiusKm: Double) {
        viewModelScope.launch {
            settingsRepository.setDefaultRadiusKm(radiusKm)
        }
    }

    fun setMapMode(mode: String) {
        viewModelScope.launch {
            settingsRepository.setMapMode(mode)
        }
    }

    fun setOnlyActiveByDefault(value: Boolean) {
        viewModelScope.launch {
            settingsRepository.setOnlyActiveByDefault(value)
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            transient.update { it.copy(isClearing = true, message = null) }
            runCatching {
                plannedRouteRepository.deleteAll()
                customerRepository.deleteAll()
            }.onSuccess {
                transient.update { it.copy(isClearing = false, message = "Base local limpa com sucesso.") }
            }.onFailure { throwable ->
                transient.update {
                    it.copy(
                        isClearing = false,
                        message = throwable.message ?: "Falha ao limpar dados."
                    )
                }
            }
        }
    }

    fun clearMessage() {
        transient.update { it.copy(message = null) }
    }
}

data class SettingsUiState(
    val defaultRadiusKm: Double = 5.0,
    val mapMode: String = "NORMAL",
    val onlyActiveByDefault: Boolean = true,
    val isClearing: Boolean = false,
    val message: String? = null
)

private data class SettingsTransientState(
    val isClearing: Boolean = false,
    val message: String? = null
)

