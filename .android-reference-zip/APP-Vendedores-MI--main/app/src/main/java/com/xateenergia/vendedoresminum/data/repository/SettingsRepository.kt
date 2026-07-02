package com.xateenergia.vendedoresminum.data.repository

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore by preferencesDataStore(name = "sales_route_settings")

@Singleton
class SettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context
) {
    val defaultRadiusKm: Flow<Double> = context.settingsDataStore.data.map { preferences ->
        preferences[DEFAULT_RADIUS_KM] ?: 5.0
    }

    val mapMode: Flow<String> = context.settingsDataStore.data.map { preferences ->
        preferences[MAP_MODE] ?: "NORMAL"
    }

    val onlyActiveByDefault: Flow<Boolean> = context.settingsDataStore.data.map { preferences ->
        preferences[ONLY_ACTIVE] ?: true
    }

    suspend fun setDefaultRadiusKm(value: Double) {
        context.settingsDataStore.edit { preferences ->
            preferences[DEFAULT_RADIUS_KM] = value.coerceIn(1.0, 50.0)
        }
    }

    suspend fun setMapMode(value: String) {
        context.settingsDataStore.edit { preferences ->
            preferences[MAP_MODE] = value
        }
    }

    suspend fun setOnlyActiveByDefault(value: Boolean) {
        context.settingsDataStore.edit { preferences ->
            preferences[ONLY_ACTIVE] = value
        }
    }

    private companion object {
        val DEFAULT_RADIUS_KM = doublePreferencesKey("default_radius_km")
        val MAP_MODE = stringPreferencesKey("map_mode")
        val ONLY_ACTIVE = booleanPreferencesKey("only_active")
    }
}

