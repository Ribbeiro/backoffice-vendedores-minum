package com.xateenergia.vendedoresminum.presentation.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val LightColors = lightColorScheme(
    primary = Color(0xFF146C5F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD8F0EA),
    onPrimaryContainer = Color(0xFF092E28),
    secondary = Color(0xFF405E7A),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD9E7F5),
    onSecondaryContainer = Color(0xFF102235),
    tertiary = Color(0xFFB65F21),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFDFC9),
    background = Color(0xFFF5F7F8),
    onBackground = Color(0xFF18211F),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF18211F),
    surfaceVariant = Color(0xFFE4E8E7),
    onSurfaceVariant = Color(0xFF414A48),
    outline = Color(0xFF73807D),
    error = Color(0xFFBA1A1A),
    onError = Color.White
)

private val AppShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(4.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
)

private val AppTypography = Typography()

@Composable
fun VendedoresMinumTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
