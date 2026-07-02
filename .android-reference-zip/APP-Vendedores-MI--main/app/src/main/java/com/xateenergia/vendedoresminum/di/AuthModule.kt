package com.xateenergia.vendedoresminum.di

import com.xateenergia.vendedoresminum.data.repository.FirebaseAuthRepository
import com.xateenergia.vendedoresminum.domain.repository.AuthRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class AuthModule {
    @Binds
    @Singleton
    abstract fun bindAuthRepository(repository: FirebaseAuthRepository): AuthRepository
}
