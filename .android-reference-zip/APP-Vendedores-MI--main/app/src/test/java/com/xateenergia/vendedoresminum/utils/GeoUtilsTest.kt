package com.xateenergia.vendedoresminum.utils

import com.xateenergia.vendedoresminum.domain.model.Coordinate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeoUtilsTest {
    @Test
    fun haversineDistanceMeters_returnsExpectedDistance() {
        val saoPaulo = Coordinate(latitude = -23.55052, longitude = -46.63331)
        val rioDeJaneiro = Coordinate(latitude = -22.90685, longitude = -43.1729)

        val distanceKm = GeoUtils.haversineDistanceMeters(saoPaulo, rioDeJaneiro) / 1000.0

        assertEquals(357.0, distanceKm, 5.0)
    }

    @Test
    fun boundingBox_containsCenterAndHasValidLimits() {
        val center = Coordinate(latitude = -23.55052, longitude = -46.63331)

        val box = GeoUtils.boundingBox(center, radiusKm = 5.0)

        assertTrue(center.latitude in box.minLatitude..box.maxLatitude)
        assertTrue(center.longitude in box.minLongitude..box.maxLongitude)
        assertTrue(box.minLatitude >= -90.0)
        assertTrue(box.maxLatitude <= 90.0)
        assertTrue(box.minLongitude >= -180.0)
        assertTrue(box.maxLongitude <= 180.0)
    }
}

