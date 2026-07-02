package com.xateenergia.vendedoresminum.utils

import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Formatters {
    private val distanceFormat = NumberFormat.getNumberInstance(Locale("pt", "BR")).apply {
        minimumFractionDigits = 1
        maximumFractionDigits = 1
    }

    private val dateTimeFormat = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR"))

    fun distance(meters: Double): String {
        return if (meters < 1000.0) {
            "${meters.toInt()} m"
        } else {
            "${distanceFormat.format(meters / 1000.0)} km"
        }
    }

    fun dateTime(timestamp: Long): String = dateTimeFormat.format(Date(timestamp))
}

