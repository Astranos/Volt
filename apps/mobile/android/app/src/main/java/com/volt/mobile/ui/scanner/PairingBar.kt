package com.volt.mobile.ui.scanner

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import com.volt.mobile.model.CloudComputer
import com.volt.mobile.viewmodel.ScannerStore

@Composable
fun PairingBar(store: ScannerStore, onScanQr: () -> Unit) {
    val connected by store.connectionState.collectAsState()
    val label by store.pairingLabel.collectAsState()
    val computers by store.computers.collectAsState()
    val target by store.cursorTargetDeviceId.collectAsState()
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        if (connected == com.volt.mobile.viewmodel.ConnectionState.Disconnected) {
            OutlinedButton(onClick = onScanQr, modifier = Modifier.fillMaxWidth()) { Text("Pair with Chrome") }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Text(label ?: "Connected", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                TextButton(onClick = store::disconnect) { Text("Disconnect") }
                Box { TextButton(onClick = { expanded = true }) { Text("Target") }; DropdownMenu(expanded, { expanded = false }) { computers.filter(CloudComputer::supportsCursorInsertion).forEach { c -> DropdownMenuItem({ Text(c.label) }, { store.setCursorTarget(c.deviceId); expanded = false }) } } }
            }
            if (target != null) Text("Cursor target selected", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun PairingQrScanner(store: ScannerStore, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    Dialog(onDismissRequest = onDismiss) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx -> PreviewView(ctx).also { view ->
            val future = ProcessCameraProvider.getInstance(ctx)
            future.addListener({
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                analysis.setAnalyzer(ContextCompat.getMainExecutor(ctx)) { proxy ->
                    proxy.image?.let { image -> BarcodeScanning.getClient().process(InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees)).addOnSuccessListener { codes ->
                        codes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }?.rawValue?.let { payload -> if (store.handleIncomingUrl(payload)) onDismiss() }
                    }.addOnCompleteListener { proxy.close() } } ?: proxy.close()
                }
                provider.unbindAll(); provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }, ContextCompat.getMainExecutor(ctx))
        } })
    }
}
