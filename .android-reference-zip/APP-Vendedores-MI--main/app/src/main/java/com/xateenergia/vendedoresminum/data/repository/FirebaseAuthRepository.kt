package com.xateenergia.vendedoresminum.data.repository

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseException
import com.google.firebase.database.FirebaseDatabase
import com.xateenergia.vendedoresminum.domain.model.AuthException
import com.xateenergia.vendedoresminum.domain.model.AuthFailure
import com.xateenergia.vendedoresminum.domain.model.AuthUser
import com.xateenergia.vendedoresminum.domain.model.UserAccessResult
import com.xateenergia.vendedoresminum.domain.model.UserProfile
import com.xateenergia.vendedoresminum.domain.model.UserRole
import com.xateenergia.vendedoresminum.domain.repository.AuthRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await

@Singleton
class FirebaseAuthRepository @Inject constructor(
    @ApplicationContext private val context: Context
) : AuthRepository {

    private val database = FirebaseDatabase.getInstance()
    private val usersRef = database.getReference("users")

    override fun isConfigured(): Boolean {
        return FirebaseApp.getApps(context).isNotEmpty()
    }

    override fun observeAuthUser(): Flow<AuthUser?> {
        if (!isConfigured()) return flowOf(null)

        return callbackFlow {
            val auth = FirebaseAuth.getInstance()
            val listener = FirebaseAuth.AuthStateListener { firebaseAuth ->
                trySend(firebaseAuth.currentUser?.toDomain())
            }

            auth.addAuthStateListener(listener)
            trySend(auth.currentUser?.toDomain())

            awaitClose { auth.removeAuthStateListener(listener) }
        }
    }

    override fun observeUserProfile(uid: String, authEmail: String?): Flow<UserAccessResult> {
        if (!isConfigured()) return flowOf(UserAccessResult.Error(AuthFailure.FirebaseNotConfigured))

        return flow {
            // Leitura única no Realtime Database
            val snapshot = try {
                usersRef.child(uid).get().await()
            } catch (e: Exception) {
                Log.e("AuthDebug", "Erro ao buscar perfil no Realtime Database", e)
                emit(UserAccessResult.Error(AuthFailure.Unknown(e.message)))
                return@flow
            }

            if (!snapshot.exists()) {
                Log.w("AuthDebug", "Usuário não encontrado no Realtime Database")
                emit(UserAccessResult.Denied(AuthFailure.UserNotFound))
                return@flow
            }

            // --- LEITURA TOLERANTE A TIPOS ---
            fun getBooleanSafely(snapshot: DataSnapshot, key: String): Boolean {
                val booleanValue = snapshot.child(key).getValue(Boolean::class.java)
                if (booleanValue != null) return booleanValue

                // Se for nulo, tenta ler como string e interpreta
                val stringValue = snapshot.child(key).getValue(String::class.java)
                return when (stringValue?.trim()?.lowercase()) {
                    "true", "1", "yes", "on" -> true
                    else -> false
                }
            }

            val active = getBooleanSafely(snapshot, "active")
            val allowedAccess = getBooleanSafely(snapshot, "allowedAccess")
            val deleted = getBooleanSafely(snapshot, "deleted")

            val email = snapshot.child("email").getValue(String::class.java).orEmpty()
            val roleStr = snapshot.child("role").getValue(String::class.java)?.trim() ?: ""
            val role = UserRole.from(roleStr)

            // Log detalhado para depuração
            Log.d("AuthDebug", "Dados brutos: active=$active, allowedAccess=$allowedAccess, deleted=$deleted, email='$email', roleStr='$roleStr', role=$role")

            val result = when {
                deleted -> UserAccessResult.Denied(AuthFailure.DeletedUser)
                !active -> UserAccessResult.Denied(AuthFailure.InactiveUser)
                !allowedAccess -> UserAccessResult.Denied(AuthFailure.AccessNotAllowed)
                role == UserRole.UNKNOWN -> {
                    Log.e("AuthDebug", "Role não reconhecido: '$roleStr'")
                    UserAccessResult.Denied(AuthFailure.InvalidRole)
                }
                else -> {
                    val profile = UserProfile(
                        uid = uid,
                        name = snapshot.child("name").getValue(String::class.java) ?: email,
                        email = email,
                        role = role,
                        active = active,
                        allowedAccess = allowedAccess,
                        companyId = snapshot.child("companyId").getValue(String::class.java),
                        createdAtMillis = snapshot.child("createdAt").getValue(Long::class.java),
                        lastLoginMillis = snapshot.child("lastLogin").getValue(Long::class.java),
                        deleted = deleted,
                        phone = snapshot.child("phone").getValue(String::class.java),
                        updatedAtMillis = snapshot.child("updatedAt").getValue(Long::class.java)
                    )
                    UserAccessResult.Authorized(profile)
                }
            }
            emit(result)
        }
    }

    override suspend fun signIn(email: String, password: String): AuthUser {
        if (!isConfigured()) throw AuthException(AuthFailure.FirebaseNotConfigured)

        return mapFirebaseFailure {
            val result = FirebaseAuth.getInstance()
                .signInWithEmailAndPassword(email, password)
                .await()

            result.user?.toDomain() ?: throw AuthException(AuthFailure.InvalidCredentials)
        }
    }

    override suspend fun signOut() {
        if (isConfigured()) {
            FirebaseAuth.getInstance().signOut()
        }
    }

    override suspend fun sendPasswordReset(email: String) {
        if (!isConfigured()) throw AuthException(AuthFailure.FirebaseNotConfigured)

        mapFirebaseFailure {
            FirebaseAuth.getInstance()
                .sendPasswordResetEmail(email)
                .await()
        }
    }

    override suspend fun markLastLogin(uid: String) {
        if (!isConfigured()) return

        runCatching {
            usersRef.child(uid).child("lastLogin")
                .setValue(com.google.firebase.database.ServerValue.TIMESTAMP)
                .await()
        }
    }

    private fun com.google.firebase.auth.FirebaseUser.toDomain(): AuthUser {
        return AuthUser(uid = uid, email = email)
    }

    private suspend fun <T> mapFirebaseFailure(block: suspend () -> T): T {
        return try {
            block()
        } catch (exception: AuthException) {
            throw exception
        } catch (exception: Exception) {
            throw AuthException(exception.toAuthFailure())
        }
    }

    private fun Exception.toAuthFailure(): AuthFailure {
        return when (this) {
            is FirebaseAuthInvalidCredentialsException,
            is FirebaseAuthInvalidUserException -> AuthFailure.InvalidCredentials
            is DatabaseException -> AuthFailure.Network
            else -> AuthFailure.Unknown(message)
        }
    }
}