package com.xateenergia.vendedoresminum.domain.model

sealed interface AuthFailure {
    data object FirebaseNotConfigured : AuthFailure
    data object InvalidCredentials : AuthFailure
    data object Network : AuthFailure
    data object UserNotFound : AuthFailure
    data object InactiveUser : AuthFailure
    data object AccessNotAllowed : AuthFailure
    data object DeletedUser : AuthFailure
    data object EmailMismatch : AuthFailure
    data object MissingEmail : AuthFailure
    data object InvalidRole : AuthFailure
    data class Unknown(val message: String? = null) : AuthFailure
}

class AuthException(val failure: AuthFailure) : Exception()

sealed interface UserAccessResult {
    data class Authorized(val profile: UserProfile) : UserAccessResult
    data class Denied(val reason: AuthFailure) : UserAccessResult
    data class Error(val failure: AuthFailure) : UserAccessResult
}
