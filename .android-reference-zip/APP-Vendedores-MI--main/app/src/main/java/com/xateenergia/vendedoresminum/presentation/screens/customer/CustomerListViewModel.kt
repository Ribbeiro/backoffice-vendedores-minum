package com.xateenergia.vendedoresminum.presentation.screens.customer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xateenergia.vendedoresminum.data.repository.CustomerRepository
import com.xateenergia.vendedoresminum.domain.model.Customer
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CustomerListViewModel @Inject constructor(
    private val customerRepository: CustomerRepository
) : ViewModel() {
    private val query = MutableStateFlow("")

    val state: StateFlow<CustomerListUiState> = query
        .flatMapLatest { currentQuery ->
            customerRepository.observeCustomers(currentQuery)
        }
        .combine(query) { customers, currentQuery ->
            CustomerListUiState(query = currentQuery, customers = customers)
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = CustomerListUiState()
        )

    fun setQuery(value: String) {
        query.update { value }
    }
}

data class CustomerListUiState(
    val query: String = "",
    val customers: List<Customer> = emptyList()
)

