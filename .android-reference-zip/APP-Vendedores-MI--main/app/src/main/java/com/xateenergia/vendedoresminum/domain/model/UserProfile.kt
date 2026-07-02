package com.xateenergia.vendedoresminum.domain.model

data class UserProfile(
    val uid: String,
    val name: String,
    val email: String,
    val role: UserRole,
    val active: Boolean,
    val allowedAccess: Boolean,
    val companyId: String?,
    val createdAtMillis: Long?,
    val lastLoginMillis: Long?,
    val deleted: Boolean,
    val phone: String?,
    val updatedAtMillis: Long?
)

enum class UserRole {
    ADMIN,
    VENDEDOR,
    UNKNOWN;

    companion object {
        fun from(value: String?): UserRole {
            return when (value?.trim()?.lowercase()) {
                "admin" -> ADMIN
                "vendedor", "seller", "sales" -> VENDEDOR
                else -> UNKNOWN
            }
        }
    }
}
