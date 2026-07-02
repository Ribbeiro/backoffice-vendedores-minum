package com.xateenergia.vendedoresminum.presentation.screens.importer

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xateenergia.vendedoresminum.domain.model.ImportReport
import com.xateenergia.vendedoresminum.domain.usecase.ImportCustomersUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class ImportViewModel @Inject constructor(
    private val importCustomersUseCase: ImportCustomersUseCase
) : ViewModel() {
    private val _state = MutableStateFlow(ImportUiState())
    val state: StateFlow<ImportUiState> = _state

    fun setReplaceExisting(value: Boolean) {
        _state.update { it.copy(replaceExisting = value) }
    }

    fun importFile(uri: Uri) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null, report = null) }
            runCatching {
                importCustomersUseCase(uri, _state.value.replaceExisting)
            }.onSuccess { report ->
                _state.update { it.copy(isLoading = false, report = report) }
            }.onFailure { throwable ->
                _state.update {
                    it.copy(
                        isLoading = false,
                        error = throwable.message ?: "Falha ao importar a planilha."
                    )
                }
            }
        }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }
}

data class ImportUiState(
    val isLoading: Boolean = false,
    val replaceExisting: Boolean = false,
    val report: ImportReport? = null,
    val error: String? = null
)

