package com.example.passsafer.ui.sync

import android.net.nsd.NsdServiceInfo
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.passsafer.ui.theme.*
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncScreen(
    onBack: () -> Unit,
    importMode: Boolean = false,
    viewModel: SyncViewModel = hiltViewModel()
) {
    val syncState by viewModel.syncState.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()
    var activeTab by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        if (!importMode) viewModel.startDiscovery()
    }

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text(if (importMode) "Import from Desktop" else "LAN Sync", color = DarkOnSurface) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = null, tint = DarkOnSurface) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkBackground)
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(DarkBackground)
                .padding(padding)
        ) {
            when (syncState) {
                "success" -> SyncSuccessContent(onBack)
                "syncing" -> SyncLoadingContent()
                "error", "error_locked" -> SyncErrorContent(errorMessage, onBack) { viewModel.startDiscovery() }
                else -> {
                    TabRow(
                        selectedTabIndex = activeTab,
                        containerColor = DarkBackground,
                        contentColor = PassSaferOrange
                    ) {
                        Tab(selected = activeTab == 0, onClick = { activeTab = 0 }, text = { Text("QR Code") })
                        Tab(selected = activeTab == 1, onClick = { activeTab = 1 }, text = { Text("Manual") })
                    }
                    when (activeTab) {
                        0 -> QrScanTab(viewModel)
                        1 -> ManualConnectTab(viewModel)
                    }
                }
            }
        }
    }
}

@Composable
private fun QrScanTab(viewModel: SyncViewModel) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var scanned by remember { mutableStateOf(false) }
    var hasCameraPermission by remember {
        mutableStateOf(
            androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.CAMERA
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { granted -> hasCameraPermission = granted }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(android.Manifest.permission.CAMERA)
        }
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            "Point your camera at the QR code\nshown in PassSafer Desktop",
            style = MaterialTheme.typography.bodyMedium,
            color = DarkOnSurfaceMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))

        if (!hasCameraPermission) {
            Column(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("📷", style = MaterialTheme.typography.headlineLarge)
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    "Camera permission is required to scan QR codes.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = DarkOnSurfaceMuted,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = { permissionLauncher.launch(android.Manifest.permission.CAMERA) },
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = PassSaferOrange)
                ) {
                    Text("Grant Camera Permission")
                }
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 24.dp)
            ) {
                AndroidView(
                    factory = { ctx ->
                        val previewView = PreviewView(ctx)
                        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                        val executor = Executors.newSingleThreadExecutor()
                        val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                        cameraProviderFuture.addListener({
                            try {
                                val cameraProvider = cameraProviderFuture.get()
                                val preview = Preview.Builder().build().also {
                                    it.setSurfaceProvider(previewView.surfaceProvider)
                                }
                                val barcodeScanner = BarcodeScanning.getClient()
                                val analysis = ImageAnalysis.Builder()
                                    .setTargetResolution(android.util.Size(1280, 720))
                                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                    .build()
                                analysis.setAnalyzer(executor) { imageProxy ->
                                    val mediaImage = imageProxy.image
                                    if (mediaImage != null && !scanned) {
                                        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                                        barcodeScanner.process(image)
                                            .addOnSuccessListener { barcodes ->
                                                for (barcode in barcodes) {
                                                    if (barcode.format == Barcode.FORMAT_QR_CODE) {
                                                        val raw = barcode.rawValue ?: continue
                                                        if (raw.startsWith("passsafer://sync?")) {
                                                            scanned = true
                                                            val params = raw.substringAfter("?").split("&").mapNotNull {
                                                                val parts = it.split("=")
                                                                if (parts.size == 2) parts[0] to parts[1] else null
                                                            }.toMap()
                                                            val ip = params["ip"] ?: return@addOnSuccessListener
                                                            val port = params["port"]?.toIntOrNull() ?: return@addOnSuccessListener
                                                            val pin = params["pin"] ?: return@addOnSuccessListener
                                                            viewModel.connectAndSyncDirect(ip, port, pin)
                                                        }
                                                    }
                                                }
                                            }
                                            .addOnCompleteListener { imageProxy.close() }
                                    } else {
                                        imageProxy.close()
                                    }
                                }
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                            } catch (e: Exception) {
                                android.util.Log.e("PassSaferQR", "Camera bind failed", e)
                            }
                        }, ContextCompat.getMainExecutor(ctx))
                        previewView
                    },
                    modifier = Modifier.fillMaxSize()
                )
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = Color.Transparent,
                    border = androidx.compose.foundation.BorderStroke(2.dp, PassSaferOrange),
                    modifier = Modifier.size(220.dp).align(Alignment.Center)
                ) {}
            }
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}


@Composable
private fun ManualConnectTab(viewModel: SyncViewModel) {
    val discoveredDevices by viewModel.discoveredDevices.collectAsState()
    var manualHost by remember { mutableStateOf("") }
    var manualPort by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var selectedDevice by remember { mutableStateOf<NsdServiceInfo?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (discoveredDevices.isNotEmpty()) {
            Text("Discovered Devices", style = MaterialTheme.typography.labelLarge, color = PassSaferOrange)
            discoveredDevices.forEach { device ->
                Surface(
                    onClick = { selectedDevice = device; manualHost = device.host?.hostAddress ?: ""; manualPort = device.port.toString() },
                    shape = RoundedCornerShape(14.dp),
                    color = if (selectedDevice == device) PassSaferOrange.copy(alpha = 0.15f) else DarkSurface,
                    border = if (selectedDevice == device) androidx.compose.foundation.BorderStroke(1.dp, PassSaferOrange) else null,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("🖥", style = MaterialTheme.typography.titleLarge)
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(device.serviceName, style = MaterialTheme.typography.titleMedium, color = DarkOnSurface)
                            Text("${device.host?.hostAddress}:${device.port}", style = MaterialTheme.typography.bodySmall, color = DarkOnSurfaceMuted)
                        }
                    }
                }
            }
            HorizontalDivider(color = DarkSurfaceVariant)
        }

        Text("Manual Connection", style = MaterialTheme.typography.labelLarge, color = PassSaferOrange)
        PassSaferTextFieldStatic(value = manualHost, onValueChange = { manualHost = it }, label = "Desktop IP Address")
        PassSaferTextFieldStatic(value = manualPort, onValueChange = { manualPort = it }, label = "Port", keyboardType = KeyboardType.Number)
        PassSaferTextFieldStatic(value = pin, onValueChange = { if (it.length <= 6) pin = it }, label = "6-Digit PIN", keyboardType = KeyboardType.NumberPassword)

        Spacer(modifier = Modifier.weight(1f))
        Button(
            onClick = {
                val p = manualPort.toIntOrNull() ?: 0
                if (manualHost.isNotEmpty() && p > 0 && pin.length >= 4) {
                    viewModel.connectAndSyncDirect(manualHost, p, pin)
                }
            },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = PassSaferOrange)
        ) {
            Icon(Icons.Default.QrCodeScanner, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Connect & Sync", style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun SyncSuccessContent(onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("✅", style = MaterialTheme.typography.headlineLarge)
        Spacer(modifier = Modifier.height(16.dp))
        Text("Sync Complete!", style = MaterialTheme.typography.headlineMedium, color = PassSaferOrange)
        Text("Your vault has been synchronized.", style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted, textAlign = TextAlign.Center)
        Spacer(modifier = Modifier.height(32.dp))
        Button(onClick = onBack, shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.buttonColors(containerColor = PassSaferOrange)) {
            Text("Done")
        }
    }
}

@Composable
private fun SyncLoadingContent() {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator(color = PassSaferOrange)
        Spacer(modifier = Modifier.height(20.dp))
        Text("Synchronizing...", style = MaterialTheme.typography.titleMedium, color = DarkOnSurface)
        Text("Please wait while your vault syncs.", style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted)
    }
}

@Composable
private fun SyncErrorContent(errorMessage: String?, onBack: () -> Unit, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("❌", style = MaterialTheme.typography.headlineLarge)
        Spacer(modifier = Modifier.height(16.dp))
        Text("Sync Failed", style = MaterialTheme.typography.headlineMedium, color = ErrorRed)
        if (errorMessage != null) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(errorMessage, style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted, textAlign = TextAlign.Center)
        }
        Spacer(modifier = Modifier.height(24.dp))
        Button(onClick = onRetry, shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.buttonColors(containerColor = PassSaferOrange)) {
            Text("Retry")
        }
        Spacer(modifier = Modifier.height(8.dp))
        TextButton(onClick = onBack) { Text("Go Back", color = DarkOnSurfaceMuted) }
    }
}

@Composable
private fun PassSaferTextFieldStatic(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    keyboardType: KeyboardType = KeyboardType.Text
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, color = DarkOnSurfaceMuted) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = PassSaferOrange,
            unfocusedBorderColor = DarkSurfaceVariant,
            focusedContainerColor = DarkSurface,
            unfocusedContainerColor = DarkSurface,
            cursorColor = PassSaferOrange,
            focusedTextColor = DarkOnSurface,
            unfocusedTextColor = DarkOnSurface
        )
    )
}
