package com.example.passsafer.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.passsafer.R
import com.example.passsafer.ui.theme.*

@Composable
fun WelcomeScreen(
    onCreateNew: () -> Unit,
    onSignIn: () -> Unit,
    onImportFromDesktop: () -> Unit
) {
    var visible by remember { mutableStateOf(false) }
    val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(600), label = "fade")
    LaunchedEffect(Unit) { visible = true }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0F0F10), DarkBackground, DarkSurface)))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp)
                .alpha(alpha),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_passsafer_logo),
                contentDescription = null,
                modifier = Modifier.size(110.dp)
            )
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                "PassSafer",
                style = MaterialTheme.typography.headlineLarge,
                color = PassSaferOrange
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                "Your passwords. Secured.",
                style = MaterialTheme.typography.bodyMedium,
                color = DarkOnSurfaceMuted,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(64.dp))

            WelcomeOptionButton(
                title = "Create New Vault",
                subtitle = "Set up a new master password & PIN",
                icon = "🔐",
                onClick = onCreateNew,
                primary = true
            )
            Spacer(modifier = Modifier.height(14.dp))
            WelcomeOptionButton(
                title = "Sign In",
                subtitle = "Unlock your existing vault",
                icon = "🔓",
                onClick = onSignIn,
                primary = false
            )
            Spacer(modifier = Modifier.height(14.dp))
            WelcomeOptionButton(
                title = "Import from Desktop",
                subtitle = "Scan QR code from PassSafer Desktop",
                icon = "📱",
                onClick = onImportFromDesktop,
                primary = false
            )
        }
    }
}

@Composable
private fun WelcomeOptionButton(
    title: String,
    subtitle: String,
    icon: String,
    onClick: () -> Unit,
    primary: Boolean
) {
    val containerColor = if (primary) PassSaferOrange else DarkSurfaceVariant
    val contentColor = if (primary) Color.White else DarkOnSurface

    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = containerColor,
        tonalElevation = if (primary) 4.dp else 0.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(icon, style = MaterialTheme.typography.headlineMedium)
            Spacer(modifier = Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = contentColor)
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = contentColor.copy(alpha = 0.7f))
            }
        }
    }
}
