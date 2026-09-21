package com.volt.mobile.ui.scanner

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.volt.mobile.model.ScanResult
import java.text.DateFormat
import java.util.Date

@Composable fun ResultsSheet(results: List<ScanResult>) {
    val context = LocalContext.current
    LazyColumn(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(results, key = { it.id }) { result ->
        val color = when (result.deliveryState) { ScanResult.DeliveryState.SAVED -> MaterialTheme.colorScheme.onSurfaceVariant; ScanResult.DeliveryState.SENDING -> MaterialTheme.colorScheme.primary; ScanResult.DeliveryState.SENT -> Color(0xFF2E7D32); ScanResult.DeliveryState.FAILED -> MaterialTheme.colorScheme.error }
        ListItem(leadingContent = { Icon(if (result.kind == ScanResult.Kind.BARCODE) Icons.Default.QrCode else Icons.Default.Description, null) }, headlineContent = { Text(result.value, maxLines = 2) }, supportingContent = { Text("${DateFormat.getDateTimeInstance().format(Date(result.capturedAt))} · ${result.deliveryState.label}", color = color) }, modifier = Modifier.combinedClickable(onClick = {}, onLongClick = { (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Volt capture", result.value)) }))
    } }
}
