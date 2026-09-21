package com.volt.mobile

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import com.clerk.api.Clerk
import com.clerk.api.network.serialization.ClerkResult
import com.clerk.api.session.GetTokenOptions
import com.volt.mobile.service.DeviceBootstrap
import com.volt.mobile.service.MobileCloudApiClient
import com.volt.mobile.ui.auth.*
import com.volt.mobile.ui.scanner.CaptureScreen
import com.volt.mobile.ui.theme.VoltTheme
import com.volt.mobile.viewmodel.ScannerStore
import kotlinx.coroutines.launch
import java.util.UUID

class MainActivity : ComponentActivity() {
    private val scannerStore by viewModels<ScannerStore>()
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); handleIntent(intent); setContent { VoltTheme { VoltRoot(scannerStore) } } }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }
    private fun handleIntent(intent: Intent?) { intent?.dataString?.let(scannerStore::handleIncomingUrl) }
}

@Composable
private fun VoltRoot(store: ScannerStore) {
    val initialized by Clerk.isInitialized.collectAsState()
    val user by Clerk.userFlow.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var authOpen by remember { mutableStateOf(false) }

    LaunchedEffect(user) {
        if (user == null) return@LaunchedEffect
        // Signed in: bootstrap (or reuse) this installation's cloud device credential.
        val appContext = context.applicationContext
        scope.launch {
            when (val result = Clerk.auth.getToken(GetTokenOptions(template = AppConfiguration.CLERK_JWT_TEMPLATE, skipCache = true))) {
                is ClerkResult.Success -> {
                    runCatching {
                        DeviceBootstrap(appContext, MobileCloudApiClient())
                            .ensureBootstrapped(UUID.randomUUID().toString(), Build.MODEL, result.value)
                    }
                    store.refreshAfterBootstrap()
                }
                else -> Unit
            }
        }
    }

    when {
        !initialized -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        user == null -> Box(Modifier.fillMaxSize()) { AuthenticationLandingView { authOpen = true }; if (authOpen) AuthSheet { authOpen = false } }
        else -> CaptureScreen(store) { scope.launch { Clerk.auth.signOut() } }
    }
}
