package com.xateenergia.vendedoresminum.domain.repository

import com.xateenergia.vendedoresminum.domain.model.AuthUser
import com.xateenergia.vendedoresminum.domain.model.UserAccessResult
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    fun isConfigured(): Boolean
    fun observeAuthUser(): Flow<AuthUser?>
    fun observeUserProfile(uid: String, authEmail: String?): Flow<UserAccessResult>
    suspend fun signIn(email: String, password: String): AuthUser
    suspend fun signOut()
    suspend fun sendPasswordReset(email: String)
    suspend fun markLastLogin(uid: String)
}
