package com.xateenergia.vendedoresminum.presentation.utils

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.xateenergia.vendedoresminum.domain.model.Coordinate

object ExternalIntents {
    private const val TAG = "ExternalIntents"

    fun dial(context: Context, phone: String?) {
        val cleanPhone = phone?.trim().orEmpty()
        if (cleanPhone.isBlank()) return
        try {
            val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$cleanPhone"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao abrir discador", e)
        }
    }

    fun openMap(context: Context, coordinate: Coordinate, label: String? = null) {
        val encodedLabel = Uri.encode(label ?: "Destino")
        val uri = Uri.parse("geo:${coordinate.latitude},${coordinate.longitude}?q=${coordinate.latitude},${coordinate.longitude}($encodedLabel)")
        try {
            val intent = Intent(Intent.ACTION_VIEW, uri)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao abrir mapa", e)
        }
    }

    fun navigate(context: Context, coordinate: Coordinate) {
        val uri = Uri.parse("google.navigation:q=${coordinate.latitude},${coordinate.longitude}&mode=d")
        val intent = Intent(Intent.ACTION_VIEW, uri).setPackage("com.google.android.apps.maps")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            if (intent.resolveActivity(context.packageManager) != null) {
                context.startActivity(intent)
            } else {
                openMap(context, coordinate)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao abrir navegação", e)
            openMap(context, coordinate)
        }
    }

    /**
     * Abre o Google Maps com uma rota definida por uma lista de coordenadas (origem + destinos).
     * O último ponto é considerado o destino final.
     * Adiciona &dir_action=navigate para iniciar a navegação automaticamente.
     */
    fun openRouteInGoogleMaps(context: Context, waypoints: List<Coordinate>) {
        if (waypoints.size < 2) {
            Log.w(TAG, "openRouteInGoogleMaps: menos de 2 pontos, ignorando")
            return
        }

        // Remove duplicatas consecutivas
        val uniqueWaypoints = waypoints
            .distinctBy { "${it.latitude},${it.longitude}" }
            .let { list ->
                if (list.size < 2) return
                list
            }

        val origin = uniqueWaypoints.first()
        val destination = uniqueWaypoints.last()
        // A lista de waypoints intermediários: exclui origem e destino
        val intermediates = if (uniqueWaypoints.size > 2) uniqueWaypoints.drop(1).dropLast(1) else emptyList()

        val baseUrl = "https://www.google.com/maps/dir/?api=1"
        val originParam = "origin=${origin.latitude},${origin.longitude}"
        val destinationParam = "destination=${destination.latitude},${destination.longitude}"
        val waypointsParam = if (intermediates.isNotEmpty()) {
            val waypointsStr = intermediates.joinToString("|") { "${it.latitude},${it.longitude}" }
            "&waypoints=$waypointsStr"
        } else ""

        // Parâmetro para iniciar navegação imediatamente
        val navigateParam = "&dir_action=navigate"

        val url = "$baseUrl&$originParam&$destinationParam$waypointsParam&travelmode=driving$navigateParam"
        Log.d(TAG, "Abrindo rota no Google Maps com navegação automática: $url")

        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao abrir rota no Google Maps", e)
            // Fallback: abre apenas com o destino
            openMap(context, destination, "Destino")
        }
    }
}