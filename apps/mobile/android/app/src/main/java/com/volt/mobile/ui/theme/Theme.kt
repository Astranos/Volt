package com.volt.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Green = Color(0xFF2E7D32)
private val Ink = Color(0xFF101613)

private val LightColors = lightColorScheme(primary = Green, onPrimary = Color.White, onBackground = Ink)
private val DarkColors = darkColorScheme(primary = Color(0xFF81C784), onPrimary = Color(0xFF0B3B12))

@Composable
fun VoltTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors, content = content)
}
