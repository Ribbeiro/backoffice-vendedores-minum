package com.xateenergia.vendedoresminum.domain.usecase

import android.content.Context
import android.location.Geocoder
import android.os.Build
import com.xateenergia.vendedoresminum.domain.model.Coordinate
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.Locale
import javax.inject.Inject
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class GeocodeAddressUseCase @Inject constructor(
    @ApplicationContext private val context: Context
) {
    suspend operator fun invoke(address: String): Coordinate? {
        val query = address.trim()
        if (query.isBlank()) return null
        return withContext(Dispatchers.IO) {
            val geocoder = Geocoder(context, Locale("pt", "BR"))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                suspendCoroutine { continuation ->
                    geocoder.getFromLocationName(query, 1) { results ->
                        val first = results.firstOrNull()
                        continuation.resume(first?.let { Coordinate(it.latitude, it.longitude) })
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                geocoder.getFromLocationName(query, 1)
                    ?.firstOrNull()
                    ?.let { Coordinate(it.latitude, it.longitude) }
            }
        }
    }
}

