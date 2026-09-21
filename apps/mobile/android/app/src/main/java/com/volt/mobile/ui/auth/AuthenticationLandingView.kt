package com.volt.mobile.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun AuthenticationLandingView(onSignIn: () -> Unit) {
    val green = Color(0xFF2E7D32)
    Box(Modifier.fillMaxSize().background(Color.White)) {
        Box(Modifier.fillMaxWidth().height(390.dp).background(Brush.verticalGradient(listOf(Color(0xFFE5F3E5), Color.White))))
        Column(Modifier.fillMaxSize().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(92.dp))
            Box(Modifier.size(92.dp).clip(CircleShape).background(green), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Bolt, null, tint = Color.White, modifier = Modifier.size(52.dp))
            }
            Spacer(Modifier.height(22.dp))
            Text("Volt", fontSize = 42.sp, fontWeight = FontWeight.Bold, color = Color(0xFF101613))
            Spacer(Modifier.height(12.dp))
            Text("Capture barcodes, text, and photos on your iPhone, then sync them to your workspace.", textAlign = TextAlign.Center, color = Color(0xFF536156), style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.weight(1f))
            Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(14.dp)) { Text("Sign in", fontSize = 17.sp) }
            Spacer(Modifier.height(14.dp))
            Text("Use the same account as Volt on Chrome.", color = Color(0xFF667268), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(34.dp))
        }
    }
}
