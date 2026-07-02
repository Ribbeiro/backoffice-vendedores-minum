package com.xateenergia.vendedoresminum.utils

import com.xateenergia.vendedoresminum.domain.model.Coordinate
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

object GeoUtils {
    private const val EARTH_RADIUS_METERS = 6_371_000.0

    fun isValidLatitude(value: Double): Boolean = value in -90.0..90.0

    fun isValidLongitude(value: Double): Boolean = value in -180.0..180.0

    fun isValidCoordinate(latitude: Double, longitude: Double): Boolean {
        return isValidLatitude(latitude) && isValidLongitude(longitude)
    }

    fun haversineDistanceMeters(from: Coordinate, to: Coordinate): Double {
        val latDistance = Math.toRadians(to.latitude - from.latitude)
        val lonDistance = Math.toRadians(to.longitude - from.longitude)
        val startLat = Math.toRadians(from.latitude)
        val endLat = Math.toRadians(to.latitude)

        val a = sin(latDistance / 2).pow(2.0) +
            cos(startLat) * cos(endLat) * sin(lonDistance / 2).pow(2.0)
        val c = 2 * asin(min(1.0, sqrt(a)))
        return EARTH_RADIUS_METERS * c
    }

    fun boundingBox(center: Coordinate, radiusKm: Double): BoundingBox {
        val radiusRatio = radiusKm / 6371.0
        val latDelta = Math.toDegrees(radiusRatio)
        val safeCos = max(0.000001, cos(Math.toRadians(center.latitude)))
        val lonDelta = Math.toDegrees(radiusRatio / safeCos)

        return BoundingBox(
            minLatitude = max(-90.0, center.latitude - latDelta),
            maxLatitude = min(90.0, center.latitude + latDelta),
            minLongitude = max(-180.0, center.longitude - lonDelta),
            maxLongitude = min(180.0, center.longitude + lonDelta)
        )
    }
}

data class BoundingBox(
    val minLatitude: Double,
    val maxLatitude: Double,
    val minLongitude: Double,
    val maxLongitude: Double
)
