package com.example.passsafer.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.example.passsafer.ui.screens.*
import com.example.passsafer.ui.sync.SyncScreen
import com.example.passsafer.ui.viewmodel.AuthViewModel

@Composable
fun PassSaferNavGraph(
    navController: NavHostController = rememberNavController(),
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val isLicenseActive by authViewModel.isLicenseActive.collectAsState()
    val isFirstRun by authViewModel.isFirstRun.collectAsState()

    val startDestination = when {
        !isLicenseActive -> "license"
        isFirstRun -> "welcome"
        else -> "login"
    }

    NavHost(navController = navController, startDestination = startDestination) {
        composable("license") {
            LicenseScreen(
                onLicenseActivated = {
                    navController.navigate(if (isFirstRun) "welcome" else "login") {
                        popUpTo("license") { inclusive = true }
                    }
                }
            )
        }
        composable("welcome") {
            WelcomeScreen(
                onCreateNew = {
                    navController.navigate("setup") { popUpTo("welcome") { inclusive = false } }
                },
                onSignIn = {
                    navController.navigate("login") { popUpTo("welcome") { inclusive = false } }
                },
                onImportFromDesktop = {
                    navController.navigate("sync_import")
                }
            )
        }
        composable("setup") {
            SetupScreen(
                onSetupComplete = {
                    navController.navigate("vault") { popUpTo("welcome") { inclusive = true } }
                }
            )
        }
        composable("login") {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate("vault") { popUpTo("login") { inclusive = true } }
                },
                onNavigateToRegister = { navController.navigate("setup") }
            )
        }
        composable("vault") {
            VaultScreen(
                onNavigateToDetail = { id -> navController.navigate("entry_detail/$id") },
                onNavigateToGenerator = { navController.navigate("generator") },
                onNavigateToSettings = { navController.navigate("settings") },
                onNavigateToSecurity = { navController.navigate("security_center") }
            )
        }
        composable("entry_detail/{id}") { backStackEntry ->
            val id = backStackEntry.arguments?.getString("id") ?: ""
            EntryDetailScreen(entryId = id, onBack = { navController.popBackStack() })
        }
        composable("generator") {
            GeneratorScreen(onBack = { navController.popBackStack() })
        }
        composable("settings") {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onNavigateToSync = { navController.navigate("sync") }
            )
        }
        composable("sync") {
            SyncScreen(onBack = { navController.popBackStack() })
        }
        composable("sync_import") {
            SyncScreen(
                onBack = { navController.popBackStack() },
                importMode = true
            )
        }
        composable("security_center") {
            SecurityScreen(onBack = { navController.popBackStack() })
        }
    }
}
