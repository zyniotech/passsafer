package com.example.passsafer.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.passsafer.R
import com.example.passsafer.data.model.PasswordEntry
import com.example.passsafer.ui.theme.*
import com.example.passsafer.ui.viewmodel.AuthViewModel
import com.example.passsafer.ui.viewmodel.GeneratorViewModel
import com.example.passsafer.ui.viewmodel.VaultViewModel

@Composable
fun SetupScreen(onSetupComplete: () -> Unit, viewModel: AuthViewModel = hiltViewModel()) {
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    val isAuthenticated by viewModel.isAuthenticated.collectAsState()
    val error by viewModel.error.collectAsState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) onSetupComplete()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0F0F10), DarkBackground)))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_passsafer_logo),
                contentDescription = null,
                modifier = Modifier.size(80.dp)
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text("Create Your Vault", style = MaterialTheme.typography.headlineMedium, color = PassSaferOrange)
            Text("Set up your master password and PIN", style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted, textAlign = TextAlign.Center)
            Spacer(modifier = Modifier.height(36.dp))

            PassSaferTextField(
                value = password,
                onValueChange = { password = it; viewModel.clearError() },
                label = "Master Password",
                isPassword = true,
                showPassword = showPassword,
                onToggleVisibility = { showPassword = !showPassword }
            )
            Spacer(modifier = Modifier.height(12.dp))
            PassSaferTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it; viewModel.clearError() },
                label = "Confirm Password",
                isPassword = true
            )
            Spacer(modifier = Modifier.height(12.dp))
            PassSaferTextField(
                value = pin,
                onValueChange = { if (it.length <= 6) pin = it; viewModel.clearError() },
                label = "PIN (4–6 digits)",
                isPassword = true,
                keyboardType = KeyboardType.NumberPassword
            )

            if (error != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(error!!, color = ErrorRed, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }

            Spacer(modifier = Modifier.height(28.dp))
            PrimaryButton(text = "Create Vault") {
                viewModel.register(password, confirmPassword, pin)
            }
            Spacer(modifier = Modifier.height(12.dp))
            val context = androidx.compose.ui.platform.LocalContext.current as? androidx.fragment.app.FragmentActivity
            SecondaryButton(text = "Setup Biometric Unlock") {
                if (context != null && password.length >= 8 && password == confirmPassword) {
                    viewModel.setupBiometric(context, password)
                }
            }
        }
    }
}

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    onNavigateToRegister: () -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel()
) {
    var password by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    val isAuthenticated by viewModel.isAuthenticated.collectAsState()
    val error by viewModel.error.collectAsState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) onLoginSuccess()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0F0F10), DarkBackground)))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_passsafer_logo),
                contentDescription = null,
                modifier = Modifier.size(100.dp)
            )
            Spacer(modifier = Modifier.height(20.dp))
            Text("PassSafer", style = MaterialTheme.typography.headlineLarge, color = PassSaferOrange)
            Text("Unlock Your Vault", style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted)
            Spacer(modifier = Modifier.height(44.dp))

            PassSaferTextField(
                value = password,
                onValueChange = { password = it; viewModel.clearError() },
                label = "Master Password",
                isPassword = true,
                showPassword = showPassword,
                onToggleVisibility = { showPassword = !showPassword }
            )
            Spacer(modifier = Modifier.height(12.dp))
            PassSaferTextField(
                value = pin,
                onValueChange = { if (it.length <= 6) pin = it; viewModel.clearError() },
                label = "PIN",
                isPassword = true,
                keyboardType = KeyboardType.NumberPassword
            )

            if (error != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(error!!, color = ErrorRed, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }

            Spacer(modifier = Modifier.height(28.dp))
            PrimaryButton(text = "Unlock Vault") {
                viewModel.login(password, pin)
            }
            Spacer(modifier = Modifier.height(12.dp))
            val context = androidx.compose.ui.platform.LocalContext.current as? androidx.fragment.app.FragmentActivity
            SecondaryButton(text = "Unlock with Biometrics") {
                if (context != null) viewModel.loginWithBiometric(context)
            }
            Spacer(modifier = Modifier.height(20.dp))
            TextButton(onClick = onNavigateToRegister) {
                Text("Create new vault", color = PassSaferOrange, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultScreen(
    onNavigateToDetail: (String) -> Unit,
    onNavigateToGenerator: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToSecurity: () -> Unit,
    viewModel: VaultViewModel = hiltViewModel()
) {
    val passwords by viewModel.passwords.collectAsState(emptyList())
    val searchQuery by viewModel.searchQuery.collectAsState()
    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(id = R.drawable.ic_passsafer_logo),
                            contentDescription = null,
                            modifier = Modifier.size(30.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text("PassSafer", style = MaterialTheme.typography.titleLarge, color = PassSaferOrange)
                    }
                },
                actions = {
                    IconButton(onClick = onNavigateToSecurity) {
                        Icon(Icons.Default.Security, contentDescription = null, tint = DarkOnSurfaceMuted)
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, contentDescription = null, tint = DarkOnSurfaceMuted)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkBackground)
            )
        },
        bottomBar = {
            NavigationBar(containerColor = DarkSurface) {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    icon = { Icon(Icons.Default.Lock, contentDescription = null) },
                    label = { Text("Vault") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = PassSaferOrange.copy(alpha = 0.2f), selectedIconColor = PassSaferOrange, selectedTextColor = PassSaferOrange, unselectedIconColor = DarkOnSurfaceMuted, unselectedTextColor = DarkOnSurfaceMuted)
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1; onNavigateToGenerator() },
                    icon = { Icon(Icons.Default.Refresh, contentDescription = null) },
                    label = { Text("Generator") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = PassSaferOrange.copy(alpha = 0.2f), selectedIconColor = PassSaferOrange, selectedTextColor = PassSaferOrange, unselectedIconColor = DarkOnSurfaceMuted, unselectedTextColor = DarkOnSurfaceMuted)
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2; onNavigateToSettings() },
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    label = { Text("Settings") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = PassSaferOrange.copy(alpha = 0.2f), selectedIconColor = PassSaferOrange, selectedTextColor = PassSaferOrange, unselectedIconColor = DarkOnSurfaceMuted, unselectedTextColor = DarkOnSurfaceMuted)
                )
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { onNavigateToDetail("new") },
                containerColor = PassSaferOrange,
                contentColor = Color.White
            ) {
                Icon(Icons.Default.Add, contentDescription = null)
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(DarkBackground)
                .padding(padding)
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { viewModel.setSearchQuery(it) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search passwords...", color = DarkOnSurfaceMuted) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = DarkOnSurfaceMuted) },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
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
            if (passwords.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("🔐", fontSize = 48.sp)
                        Spacer(modifier = Modifier.height(12.dp))
                        Text("No passwords yet", style = MaterialTheme.typography.titleMedium, color = DarkOnSurfaceMuted)
                        Text("Tap + to add your first entry", style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted.copy(alpha = 0.6f))
                    }
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                    items(passwords) { entry ->
                        PasswordCard(entry = entry, onClick = { onNavigateToDetail(entry.id) })
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun PasswordCard(entry: PasswordEntry, onClick: () -> Unit) {
    val initial = entry.app.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = DarkSurface,
        tonalElevation = 2.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(PassSaferOrange.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Text(initial, style = MaterialTheme.typography.titleLarge, color = PassSaferOrange)
            }
            Spacer(modifier = Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(entry.app, style = MaterialTheme.typography.titleMedium, color = DarkOnSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (entry.username.isNotEmpty()) {
                    Text(entry.username, style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = DarkOnSurfaceMuted)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EntryDetailScreen(entryId: String, onBack: () -> Unit, viewModel: VaultViewModel = hiltViewModel()) {
    val passwords by viewModel.passwords.collectAsState(emptyList())
    val existingEntry = passwords.find { it.id == entryId }

    var app by remember { mutableStateOf(existingEntry?.app ?: "") }
    var username by remember { mutableStateOf(existingEntry?.username ?: "") }
    var password by remember { mutableStateOf(existingEntry?.password ?: "") }
    var link by remember { mutableStateOf(existingEntry?.link ?: "") }
    var notes by remember { mutableStateOf(existingEntry?.notes ?: "") }
    var showPassword by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text(if (entryId == "new") "New Entry" else "Edit Entry", color = DarkOnSurface) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = null, tint = DarkOnSurface) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkBackground)
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(DarkBackground)
                .padding(padding)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { Spacer(modifier = Modifier.height(4.dp)) }
            item {
                PassSaferTextField(value = app, onValueChange = { app = it }, label = "App / Website")
            }
            item {
                PassSaferTextField(value = username, onValueChange = { username = it }, label = "Username / Email")
            }
            item {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.weight(1f)) {
                        PassSaferTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = "Password",
                            isPassword = true,
                            showPassword = showPassword,
                            onToggleVisibility = { showPassword = !showPassword }
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    IconButton(
                        onClick = { viewModel.copyToClipboard(context, password) },
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(DarkSurfaceVariant)
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, tint = PassSaferOrange)
                    }
                }
            }
            item {
                PassSaferTextField(value = link, onValueChange = { link = it }, label = "Website URL")
            }
            item {
                PassSaferTextField(value = notes, onValueChange = { notes = it }, label = "Notes")
            }
            item { Spacer(modifier = Modifier.height(8.dp)) }
            item {
                PrimaryButton(text = "Save Entry") {
                    val newEntry = PasswordEntry(
                        id = if (entryId == "new") java.util.UUID.randomUUID().toString() else entryId,
                        app = app, username = username, password = password, link = link, notes = notes
                    )
                    if (entryId == "new") viewModel.addEntry(newEntry) else viewModel.updateEntry(newEntry)
                    onBack()
                }
            }
            if (entryId != "new" && existingEntry != null) {
                item {
                    Button(
                        onClick = { viewModel.deleteEntry(existingEntry); onBack() },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Delete Entry")
                    }
                }
            }
            item { Spacer(modifier = Modifier.height(24.dp)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GeneratorScreen(onBack: () -> Unit, viewModel: GeneratorViewModel = hiltViewModel()) {
    val generatedPassword by viewModel.generatedPassword.collectAsState()
    var length by remember { mutableFloatStateOf(16f) }
    var useUpper by remember { mutableStateOf(true) }
    var useLower by remember { mutableStateOf(true) }
    var useDigits by remember { mutableStateOf(true) }
    var useSpecial by remember { mutableStateOf(true) }
    val context = androidx.compose.ui.platform.LocalContext.current

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text("Password Generator", color = DarkOnSurface) },
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
                .padding(horizontal = 20.dp)
        ) {
            Spacer(modifier = Modifier.height(16.dp))
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = DarkSurface,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("Generated Password", style = MaterialTheme.typography.labelLarge, color = DarkOnSurfaceMuted)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(generatedPassword.ifEmpty { "Tap Generate" }, style = MaterialTheme.typography.bodyLarge, color = PassSaferOrange)
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton(text = "Copy", modifier = Modifier.weight(1f)) {
                            viewModel.copyToClipboard(context, generatedPassword)
                        }
                        PrimaryButton(text = "Generate", modifier = Modifier.weight(1f)) {
                            viewModel.generatePassword(length.toInt(), useUpper, useLower, useDigits, useSpecial)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            Surface(shape = RoundedCornerShape(16.dp), color = DarkSurface, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("Length: ${length.toInt()}", style = MaterialTheme.typography.titleMedium, color = DarkOnSurface)
                    Slider(
                        value = length,
                        onValueChange = { length = it },
                        valueRange = 8f..64f,
                        colors = SliderDefaults.colors(thumbColor = PassSaferOrange, activeTrackColor = PassSaferOrange)
                    )
                    HorizontalDivider(color = DarkSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
                    GeneratorToggle("Uppercase (A-Z)", useUpper) { useUpper = it }
                    GeneratorToggle("Lowercase (a-z)", useLower) { useLower = it }
                    GeneratorToggle("Digits (0-9)", useDigits) { useDigits = it }
                    GeneratorToggle("Special (!@#$)", useSpecial) { useSpecial = it }
                }
            }
        }
    }
}

@Composable
private fun GeneratorToggle(label: String, checked: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = DarkOnSurface)
        Switch(
            checked = checked,
            onCheckedChange = onToggle,
            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = PassSaferOrange)
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onNavigateToSync: () -> Unit = {},
    viewModel: VaultViewModel = hiltViewModel(),
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var exportPassword by remember { mutableStateOf("") }
    var importPassword by remember { mutableStateOf("") }
    var biometricPassword by remember { mutableStateOf("") }

    val exportLauncher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null && exportPassword.isNotEmpty()) viewModel.exportVault(uri, context, exportPassword)
    }
    val importLauncher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && importPassword.isNotEmpty()) viewModel.importVault(uri, context, importPassword)
    }
    val importCsvLauncher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) viewModel.importCsv(uri, context)
    }

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text("Settings", color = DarkOnSurface) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = null, tint = DarkOnSurface) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkBackground)
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(DarkBackground)
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                SettingsSectionHeader("LAN Sync")
                Surface(shape = RoundedCornerShape(14.dp), color = DarkSurface, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Sync your vault with PassSafer Desktop via QR code or manual connection.", style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted)
                        Spacer(modifier = Modifier.height(12.dp))
                        PrimaryButton(text = "📱 Scan QR Code / Connect to Desktop", onClick = onNavigateToSync)
                    }
                }
            }
            item {
                SettingsSectionHeader("Biometric Login")
                Surface(shape = RoundedCornerShape(14.dp), color = DarkSurface, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        PassSaferTextField(
                            value = biometricPassword,
                            onValueChange = { biometricPassword = it },
                            label = "Enter Master Password to enable",
                            isPassword = true
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        SecondaryButton(text = "Enable Biometric Login") {
                            if (biometricPassword.isNotEmpty() && context is androidx.fragment.app.FragmentActivity) {
                                authViewModel.setupBiometric(context, biometricPassword)
                                biometricPassword = ""
                            }
                        }
                    }
                }
            }
            item {
                SettingsSectionHeader("Export")
                Surface(shape = RoundedCornerShape(14.dp), color = DarkSurface, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        PassSaferTextField(value = exportPassword, onValueChange = { exportPassword = it }, label = "Export Password", isPassword = true)
                        Spacer(modifier = Modifier.height(10.dp))
                        SecondaryButton(text = "Export as .pass") { exportLauncher.launch("passsafer_export.pass") }
                    }
                }
            }
            item {
                SettingsSectionHeader("Import")
                Surface(shape = RoundedCornerShape(14.dp), color = DarkSurface, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        PassSaferTextField(value = importPassword, onValueChange = { importPassword = it }, label = "Import Password", isPassword = true)
                        Spacer(modifier = Modifier.height(10.dp))
                        SecondaryButton(text = "Import .pass File") { importLauncher.launch(arrayOf("application/octet-stream", "*/*")) }
                        Spacer(modifier = Modifier.height(8.dp))
                        SecondaryButton(text = "Import CSV") { importCsvLauncher.launch(arrayOf("text/csv", "*/*")) }
                    }
                }
            }
            item { Spacer(modifier = Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun SettingsSectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = PassSaferOrange,
        modifier = Modifier.padding(start = 4.dp, bottom = 6.dp, top = 8.dp)
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecurityScreen(onBack: () -> Unit, viewModel: VaultViewModel = hiltViewModel()) {
    val passwords by viewModel.passwords.collectAsState(emptyList())
    val weakPasswords = passwords.filter { it.password.length < 8 }
    val duplicates = passwords.groupBy { it.password }.filter { it.value.size > 1 }.values.flatten().distinctBy { it.id }
    val oldPasswords = passwords.filter { it.updatedAt < System.currentTimeMillis() - 1000L * 60 * 60 * 24 * 30 * 6 }

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text("Security Center", color = DarkOnSurface) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = null, tint = DarkOnSurface) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkBackground)
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().background(DarkBackground).padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item { SecuritySection("Weak Passwords", weakPasswords.size, weakPasswords) }
            item { SecuritySection("Duplicate Passwords", duplicates.size, duplicates) }
            item { SecuritySection("Old Passwords (>6 months)", oldPasswords.size, oldPasswords) }
            item { Spacer(modifier = Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun SecuritySection(title: String, count: Int, items: List<PasswordEntry>) {
    Surface(shape = RoundedCornerShape(14.dp), color = DarkSurface, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = DarkOnSurface, modifier = Modifier.weight(1f))
                Surface(shape = CircleShape, color = if (count > 0) ErrorRed else Color(0xFF32D74B)) {
                    Text(count.toString(), style = MaterialTheme.typography.labelLarge, color = Color.White, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                }
            }
            if (items.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                items.forEach { entry ->
                    Text("• ${entry.app} (${entry.username})", style = MaterialTheme.typography.bodyMedium, color = DarkOnSurfaceMuted, modifier = Modifier.padding(start = 4.dp, bottom = 2.dp))
                }
            }
        }
    }
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = PassSaferOrange, contentColor = Color.White)
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(14.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, PassSaferOrange)
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = PassSaferOrange)
    }
}

@Composable
fun PassSaferTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    isPassword: Boolean = false,
    showPassword: Boolean = false,
    onToggleVisibility: (() -> Unit)? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, color = DarkOnSurfaceMuted) },
        singleLine = true,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        visualTransformation = if (isPassword && !showPassword) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (isPassword) keyboardType else KeyboardType.Text),
        trailingIcon = if (isPassword && onToggleVisibility != null) {
            {
                IconButton(onClick = onToggleVisibility) {
                    Icon(
                        if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = null,
                        tint = DarkOnSurfaceMuted
                    )
                }
            }
        } else null,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = PassSaferOrange,
            unfocusedBorderColor = DarkSurfaceVariant,
            focusedContainerColor = DarkSurface,
            unfocusedContainerColor = DarkSurface,
            cursorColor = PassSaferOrange,
            focusedTextColor = DarkOnSurface,
            unfocusedTextColor = DarkOnSurface,
            focusedLabelColor = PassSaferOrange
        )
    )
}
