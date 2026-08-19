package com.example.passsafer.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.passsafer.R
import com.example.passsafer.ui.viewmodel.AuthViewModel

@Composable
fun LicenseScreen(
    onLicenseActivated: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel()
) {
    var licenseKey by remember { mutableStateOf("") }
    val isLicenseActive by viewModel.isLicenseActive.collectAsState()
    val licenseError by viewModel.licenseError.collectAsState()

    LaunchedEffect(isLicenseActive) {
        if (isLicenseActive) {
            onLicenseActivated()
        }
    }

    Scaffold { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.ic_passsafer_logo),
                        contentDescription = "PassSafer Logo",
                        modifier = Modifier.size(72.dp)
                    )
                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = "PassSafer",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "License Activation Required",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Enter your PassSafer license key (e.g. PSAF-XXXX-XXXX-XXXX-XXXX) to activate the application on your device.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(24.dp))

                    OutlinedTextField(
                        value = licenseKey,
                        onValueChange = { licenseKey = it.uppercase() },
                        label = { Text("License Key") },
                        placeholder = { Text("PSAF-XXXX-XXXX-XXXX-XXXX") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters)
                    )

                    if (licenseError != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = licenseError!!,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                            textAlign = TextAlign.Center
                        )
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = { viewModel.activateLicense(licenseKey) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        Text("Activate License", style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        }
    }
}
