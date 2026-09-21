@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.volt.mobile.ui.scanner

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Size
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.volt.mobile.model.CaptureMode
import com.volt.mobile.viewmodel.ScannerStore
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine

@Composable
fun CaptureScreen(store: ScannerStore, onSignOut: () -> Unit) {
    val mode by store.activeMode.collectAsState()
    val imageCapture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val mainExecutor = remember(context) { ContextCompat.getMainExecutor(context) }
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(title = { Text("Volt") }, actions = { Box { IconButton({ menu = true }) { Icon(Icons.Default.MoreVert, null) }; DropdownMenu(menu, { menu = false }) { DropdownMenuItem({ Text("Retry sync") }, { store.retryPending(); menu = false }); DropdownMenuItem({ Text("Sign out") }, { onSignOut(); menu = false }) } } })
        var qrOpen by remember { mutableStateOf(false) }
        PairingBar(store) { qrOpen = true }
        if (qrOpen) PairingQrScanner(store) { qrOpen = false }
        CameraPreview(store, mode, imageCapture, Modifier.weight(1f).fillMaxWidth())
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly) { listOf(CaptureMode.OCR, CaptureMode.BARCODE, CaptureMode.PHOTO).forEach { item -> FilterChip(selected = mode == item, onClick = { store.setMode(item) }, label = { Text(item.title) }) } }
        if (mode == CaptureMode.DICTATION) Text("Dictation is not available in this version.", Modifier.padding(12.dp))
        FilledIconButton(
            onClick = { if (mode == CaptureMode.PHOTO) scope.launch { capturePhotoJpeg(imageCapture, mainExecutor)?.let { (bytes, w, h) -> store.capturePhoto(bytes, w, h) } } },
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(12.dp).size(68.dp),
        ) { Icon(Icons.Default.Camera, "Capture") }
    }
}

private data class CapturedJpeg(val bytes: ByteArray, val width: Int, val height: Int)

/** Takes an in-memory JPEG and downscales it to at most 1600px on the long edge. */
private suspend fun capturePhotoJpeg(imageCapture: ImageCapture, executor: Executor): CapturedJpeg? = suspendCancellableCoroutine { cont ->
    imageCapture.takePicture(
        executor,
        object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                try {
                    val buffer = image.planes[0].buffer
                    val original = buffer.let { ByteArray(it.remaining()) }.also { buffer.get(it) }
                    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(original, 0, original.size, options)
                    val longEdge = maxOf(options.outWidth, options.outHeight)
                    val scale = minOf(1f, 1600f / longEdge)
                    val bitmap = BitmapFactory.decodeByteArray(original, 0, original.size)
                    val scaled = if (scale < 1f) {
                        Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
                    } else bitmap
                    val out = ByteArrayOutputStream()
                    scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    if (scaled !== bitmap) bitmap.recycle()
                    cont.resume(CapturedJpeg(out.toByteArray(), scaled.width, scaled.height))
                } catch (t: Throwable) {
                    cont.resume(null)
                } finally {
                    image.close()
                }
            }

            override fun onError(exception: ImageCaptureException) {
                cont.resume(null)
            }
        },
    )
}

@SuppressLint("UnsafeOptInUsageError")
@Composable private fun CameraPreview(store: ScannerStore, mode: CaptureMode, imageCapture: ImageCapture, modifier: Modifier) {
    val context = LocalContext.current; val owner = LocalLifecycleOwner.current
    AndroidView(modifier = modifier, factory = { ctx -> PreviewView(ctx).also { view ->
        val cameraProvider = ProcessCameraProvider.getInstance(ctx)
        cameraProvider.addListener({
            val provider = cameraProvider.get(); val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
            val analysis = ImageAnalysis.Builder().setTargetResolution(Size(1280, 720)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            val executor = Executors.newSingleThreadExecutor(); var last = ""; var lastAt = 0L
            analysis.setAnalyzer(executor) { imageProxy ->
                @androidx.camera.core.ExperimentalGetImage val media = imageProxy.image
                if (media == null) { imageProxy.close(); return@setAnalyzer }
                val input = InputImage.fromMediaImage(media, imageProxy.imageInfo.rotationDegrees)
                if (mode == CaptureMode.BARCODE) BarcodeScanning.getClient().process(input).addOnSuccessListener { codes -> codes.firstOrNull()?.let { value -> val now = System.currentTimeMillis(); if (value.rawValue != null && (value.rawValue != last || now - lastAt > 1500)) { last = value.rawValue!!; lastAt = now; store.onBarcode(value.rawValue!!, value.format.toString()) } } }.addOnCompleteListener { imageProxy.close() }
                else if (mode == CaptureMode.OCR) TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).process(input).addOnSuccessListener { store.onOcrText(it.text) }.addOnCompleteListener { imageProxy.close() }
                else imageProxy.close()
            }
            provider.unbindAll()
            provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, imageCapture)
        }, ContextCompat.getMainExecutor(ctx))
        } })
}
