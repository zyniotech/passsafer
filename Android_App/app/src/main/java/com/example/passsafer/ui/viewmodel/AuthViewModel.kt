package com.example.passsafer.ui.viewmodel

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.passsafer.data.license.LicenseManager
import com.example.passsafer.data.model.Vault
import com.example.passsafer.data.repository.VaultRepository
import com.example.passsafer.data.session.SessionManager
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val vaultRepository: VaultRepository,
    private val sessionManager: SessionManager,
    private val licenseManager: LicenseManager,
    @ApplicationContext private val applicationContext: Context
) : ViewModel() {

    private val _isFirstRun = MutableStateFlow(false)
    val isFirstRun: StateFlow<Boolean> = _isFirstRun.asStateFlow()

    private val _isLicenseActive = MutableStateFlow(false)
    val isLicenseActive: StateFlow<Boolean> = _isLicenseActive.asStateFlow()

    private val _isAuthenticated = MutableStateFlow(false)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _licenseError = MutableStateFlow<String?>(null)
    val licenseError: StateFlow<String?> = _licenseError.asStateFlow()

    private val prefs: SharedPreferences = applicationContext.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()

    init {
        checkStatus()
    }

    fun checkStatus() {
        _isLicenseActive.value = licenseManager.isLicenseActive()
        val file = File(applicationContext.filesDir, "master.mh")
        _isFirstRun.value = !file.exists()
    }

    fun clearError() {
        _error.value = null
        _licenseError.value = null
    }

    fun activateLicense(key: String) {
        viewModelScope.launch {
            _licenseError.value = null
            val result = licenseManager.validateAndSaveLicense(key)
            if (result.first) {
                _isLicenseActive.value = true
            } else {
                _licenseError.value = result.second ?: "Failed to activate license."
            }
        }
    }

    fun register(password: String, confirmPassword: String, pin: String) {
        viewModelScope.launch {
            _error.value = null
            if (password.length < 8) {
                _error.value = "Password must be at least 8 characters long."
                return@launch
            }
            if (password != confirmPassword) {
                _error.value = "Passwords do not match."
                return@launch
            }
            if (pin.length < 4 || pin.length > 6) {
                _error.value = "PIN must be between 4 and 6 digits."
                return@launch
            }
            if (!licenseManager.isLicenseActive()) {
                _error.value = "Please activate a valid PassSafer license first."
                return@launch
            }

            try {
                vaultRepository.saveHash("master.mh", password)
                vaultRepository.saveHash("pin.ph", pin)
                val salt = vaultRepository.getSalt("master.mh")
                if (salt != null) {
                    val initialVaultJson = gson.toJson(Vault())
                    vaultRepository.saveVault("passwords.pw", initialVaultJson, password, salt)
                }
                sessionManager.setMasterPassword(password)
                _isAuthenticated.value = true
                _isFirstRun.value = false
            } catch (e: Exception) {
                _error.value = e.message ?: "Failed to complete setup."
            }
        }
    }

    fun login(password: String, pin: String) {
        viewModelScope.launch {
            _error.value = null
            try {
                val isPinValid = vaultRepository.verifyHash("pin.ph", pin)
                val isPasswordValid = vaultRepository.verifyHash("master.mh", password)

                if (isPinValid && isPasswordValid) {
                    sessionManager.setMasterPassword(password)
                    _isAuthenticated.value = true
                } else {
                    _error.value = "Invalid Master Password or PIN."
                }
            } catch (e: Exception) {
                _error.value = e.message ?: "Login failed."
            }
        }
    }

    fun setupBiometric(activity: FragmentActivity, password: String) {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)

            val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            val keyGenParameterSpec = KeyGenParameterSpec.Builder(
                "biometric_key",
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                .build()

            keyGenerator.init(keyGenParameterSpec)
            keyGenerator.generateKey()

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val secretKey = keyStore.getKey("biometric_key", null) as SecretKey
            cipher.init(Cipher.ENCRYPT_MODE, secretKey)

            showBiometricPrompt(activity, cipher) { result ->
                result.cryptoObject?.cipher?.let { cryptoCipher ->
                    val encrypted = cryptoCipher.doFinal(password.toByteArray(Charsets.UTF_8))
                    val iv = cryptoCipher.iv
                    prefs.edit()
                        .putString("bio_encrypted", Base64.encodeToString(encrypted, Base64.DEFAULT))
                        .putString("bio_iv", Base64.encodeToString(iv, Base64.DEFAULT))
                        .apply()
                }
            }
        } catch (e: Exception) {
            _error.value = e.message
        }
    }

    fun loginWithBiometric(activity: FragmentActivity) {
        try {
            val encryptedBase64 = prefs.getString("bio_encrypted", null)
            val ivBase64 = prefs.getString("bio_iv", null)

            if (encryptedBase64 == null || ivBase64 == null) {
                _error.value = "No biometric credentials found."
                return
            }

            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val secretKey = keyStore.getKey("biometric_key", null) as? SecretKey
            if (secretKey == null) {
                _error.value = "Biometric key missing."
                return
            }

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val iv = Base64.decode(ivBase64, Base64.DEFAULT)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))

            showBiometricPrompt(activity, cipher) { result ->
                result.cryptoObject?.cipher?.let { cryptoCipher ->
                    val encrypted = Base64.decode(encryptedBase64, Base64.DEFAULT)
                    val decrypted = cryptoCipher.doFinal(encrypted)
                    val password = String(decrypted, Charsets.UTF_8)
                    sessionManager.setMasterPassword(password)
                    _isAuthenticated.value = true
                }
            }
        } catch (e: Exception) {
            _error.value = e.message
        }
    }

    private fun showBiometricPrompt(
        activity: FragmentActivity,
        cipher: Cipher,
        onSuccess: (BiometricPrompt.AuthenticationResult) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val biometricPrompt = BiometricPrompt(activity, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    _error.value = errString.toString()
                }

                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    try {
                        onSuccess(result)
                    } catch (e: Exception) {
                        _error.value = e.message
                    }
                }

                override fun onAuthenticationFailed() {
                    super.onAuthenticationFailed()
                    _error.value = "Biometric authentication failed."
                }
            })

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("PassSafer")
            .setSubtitle("Unlock your vault with biometrics")
            .setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Cancel")
            .build()

        biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
    }
}
