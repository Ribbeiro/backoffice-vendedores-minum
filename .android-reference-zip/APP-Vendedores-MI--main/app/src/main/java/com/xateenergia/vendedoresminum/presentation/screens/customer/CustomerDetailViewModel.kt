package com.xateenergia.vendedoresminum.presentation.screens.customer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xateenergia.vendedoresminum.data.repository.CustomerRepository
import com.xateenergia.vendedoresminum.domain.model.Customer
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class CustomerDetailViewModel @Inject constructor(
    private val customerRepository: CustomerRepository
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerDetailUiState(isLoading = true))
    val state: StateFlow<CustomerDetailUiState> = _state

    fun load(customerId: Long) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            val customer = customerRepository.getById(customerId)
            _state.update {
                if (customer == null) {
                    CustomerDetailUiState(error = "Cliente não encontrado.")
                } else {
                    CustomerDetailUiState(customer = customer)
                }
            }
        }
    }
}

data class CustomerDetailUiState(
    val isLoading: Boolean = false,
    val customer: Customer? = null,
    val error: String? = null
)

