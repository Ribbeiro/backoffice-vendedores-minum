package com.xateenergia.vendedoresminum.presentation.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xateenergia.vendedoresminum.domain.model.AuthException
import com.xateenergia.vendedoresminum.domain.model.AuthFailure
import com.xateenergia.vendedoresminum.domain.model.AuthUser
import com.xateenergia.vendedoresminum.domain.model.UserAccessResult
import com.xateenergia.vendedoresminum.domain.model.UserProfile
import com.xateenergia.vendedoresminum.domain.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state.asStateFlow()

    private var profileJob: Job? = null
    private var accessDeniedMessage: String? = null
    private val lastLoginUpdatedFor = mutableSetOf<String>()

    init {
        observeSession()
    }

    fun signIn(email: String, password: String) {
        val cleanEmail = email.trim()
        val validationError = when {
            cleanEmail.isBlank() -> "Informe o e-mail liberado pela empresa."
            password.isBlank() -> "Informe sua senha."
            else -> null
        }

        if (validationError != null) {
            _state.update { it.copy(errorMessage = validationError, infoMessage = null) }
            return
        }

        viewModelScope.launch {
            _state.update {
                it.copy(
                    status = AuthStatus.Checking,
                    isSubmitting = true,
                    errorMessage = null,
                    infoMessage = null
                )
            }

            try {
                authRepository.signIn(cleanEmail, password)
                _state.update { it.copy(isSubmitting = false) }
            } catch (exception: AuthException) {
                _state.update {
                    it.copy(
                        status = statusForFailure(exception.failure),
                        isSubmitting = false,
                        errorMessage = exception.failure.toFriendlyMessage()
                    )
                }
            }
        }
    }

    fun sendPasswordReset(email: String) {
        val cleanEmail = email.trim()

        if (cleanEmail.isBlank()) {
            _state.update {
                it.copy(
                    errorMessage = "Informe seu e-mail para receber a recuperacao de senha.",
                    infoMessage = null
                )
            }
            return
        }

        viewModelScope.launch {
            _state.update {
                it.copy(
                    isPasswordResetSending = true,
                    errorMessage = null,
                    infoMessage = null
                )
            }

            try {
                authRepository.sendPasswordReset(cleanEmail)
                _state.update {
                    it.copy(
                        isPasswordResetSending = false,
                        infoMessage = "Enviamos um e-mail de recuperacao de senha."
                    )
                }
            } catch (exception: AuthException) {
                _state.update {
                    it.copy(
                        isPasswordResetSending = false,
                        errorMessage = exception.failure.toFriendlyMessage()
                    )
                }
            }
        }
    }

    fun logout() {
        accessDeniedMessage = null
        profileJob?.cancel()

        viewModelScope.launch {
            authRepository.signOut()
            _state.update {
                AuthUiState(status = AuthStatus.Unauthenticated)
            }
        }
    }

    fun acknowledgeAccessDenied() {
        accessDeniedMessage = null
        _state.update {
            it.copy(
                status = AuthStatus.Unauthenticated,
                errorMessage = null,
                infoMessage = null
            )
        }
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null, infoMessage = null) }
    }

    private fun observeSession() {
        if (!authRepository.isConfigured()) {
            _state.update {
                it.copy(status = AuthStatus.ConfigurationMissing(CONFIGURATION_MESSAGE))
            }
            return
        }

        viewModelScope.launch {
            authRepository.observeAuthUser().collect { authUser ->
                if (authUser == null) {
                    profileJob?.cancel()
                    val deniedMessage = accessDeniedMessage
                    _state.update {
                        AuthUiState(
                            status = if (deniedMessage != null) {
                                AuthStatus.AccessDenied(deniedMessage)
                            } else {
                                AuthStatus.Unauthenticated
                            }
                        )
                    }
                } else {
                    observeProfile(authUser)
                }
            }
        }
    }

    private fun observeProfile(authUser: AuthUser) {
        profileJob?.cancel()
        _state.update { it.copy(status = AuthStatus.Checking, errorMessage = null) }

        profileJob = viewModelScope.launch {
            authRepository.observeUserProfile(authUser.uid, authUser.email).collect { result ->
                when (result) {
                    is UserAccessResult.Authorized -> {
                        accessDeniedMessage = null
                        _state.update {
                            AuthUiState(status = AuthStatus.Authenticated(result.profile))
                        }
                        updateLastLoginOnce(result.profile.uid)
                    }

                    is UserAccessResult.Denied -> blockAccess(result.reason.toFriendlyMessage())
                    is UserAccessResult.Error -> blockAccess(result.failure.toFriendlyMessage())
                }
            }
        }
    }

    private fun updateLastLoginOnce(uid: String) {
        if (!lastLoginUpdatedFor.add(uid)) return

        viewModelScope.launch {
            authRepository.markLastLogin(uid)
        }
    }

    private suspend fun blockAccess(message: String) {
        accessDeniedMessage = message
        authRepository.signOut()
        _state.update {
            AuthUiState(status = AuthStatus.AccessDenied(message))
        }
    }

    private fun statusForFailure(failure: AuthFailure): AuthStatus {
        return if (failure == AuthFailure.FirebaseNotConfigured) {
            AuthStatus.ConfigurationMissing(CONFIGURATION_MESSAGE)
        } else {
            AuthStatus.Unauthenticated
        }
    }

    private fun AuthFailure.toFriendlyMessage(): String {
        return when (this) {
            AuthFailure.FirebaseNotConfigured -> CONFIGURATION_MESSAGE
            AuthFailure.InvalidCredentials -> "E-mail ou senha invalidos."
            AuthFailure.Network -> "Sem conexao com a internet. Tente novamente."
            AuthFailure.UserNotFound -> "Este usuario ainda nao foi liberado pela empresa."
            AuthFailure.InactiveUser -> "Seu acesso esta inativo. Fale com o administrador."
            AuthFailure.AccessNotAllowed -> "Seu e-mail nao esta autorizado para acessar o app."
            AuthFailure.DeletedUser -> "Este usuario foi removido. Fale com o administrador."
            AuthFailure.EmailMismatch -> "O e-mail autenticado nao confere com o perfil liberado."
            AuthFailure.MissingEmail -> "O perfil liberado nao tem e-mail cadastrado."
            AuthFailure.InvalidRole -> "O perfil de acesso esta invalido. Fale com o administrador."
            is AuthFailure.Unknown -> this.message?.takeIf { it.isNotBlank() }
                ?: "Nao foi possivel concluir a operacao. Tente novamente."
        }
    }

    companion object {
        private const val CONFIGURATION_MESSAGE =
            "Firebase ainda nao foi configurado neste app. Adicione o google-services.json do projeto Firebase."
    }
}

data class AuthUiState(
    val status: AuthStatus = AuthStatus.Checking,
    val isSubmitting: Boolean = false,
    val isPasswordResetSending: Boolean = false,
    val errorMessage: String? = null,
    val infoMessage: String? = null
)

sealed interface AuthStatus {
    data object Checking : AuthStatus
    data object Unauthenticated : AuthStatus
    data class Authenticated(val profile: UserProfile) : AuthStatus
    data class AccessDenied(val message: String) : AuthStatus
    data class ConfigurationMissing(val message: String) : AuthStatus
}
