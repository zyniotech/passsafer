package com.example.passsafer.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.passsafer.data.model.PasswordEntry
import com.example.passsafer.data.model.Vault
import com.example.passsafer.data.repository.VaultRepository
import com.example.passsafer.data.session.SessionManager
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

@HiltViewModel
class VaultViewModel @Inject constructor(
    private val vaultRepository: VaultRepository,
    private val sessionManager: SessionManager
) : ViewModel() {
    private val gson = Gson()
    private var vault = Vault()
    private var masterPassword = ""

    private val _passwords = MutableStateFlow<List<PasswordEntry>>(emptyList())
    
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    val passwords = combine(_passwords, _searchQuery) { list, query ->
        if (query.isEmpty()) list else list.filter {
            it.app.contains(query, ignoreCase = true) || it.username.contains(query, ignoreCase = true)
        }
    }

    init {
        viewModelScope.launch {
            sessionManager.masterPassword.collect { pwd ->
                if (pwd != null) {
                    masterPassword = pwd
                    loadVault()
                }
            }
        }
    }

    fun setSearchQuery(query: String) {
        _searchQuery.value = query
    }

    private fun loadVault() {
        viewModelScope.launch {
            try {
                val salt = vaultRepository.getSalt("master.mh") ?: return@launch
                val json = vaultRepository.readVault("passwords.pw", masterPassword, salt)
                if (json != null) {
                    vault = gson.fromJson(json, Vault::class.java)
                    _passwords.value = vault.passwords
                } else {
                    vault = Vault()
                    _passwords.value = emptyList()
                }
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    private fun saveVault() {
        viewModelScope.launch {
            try {
                val salt = vaultRepository.getSalt("master.mh") ?: return@launch
                val json = gson.toJson(vault)
                vaultRepository.saveVault("passwords.pw", json, masterPassword, salt)
                _passwords.value = vault.passwords
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun addEntry(entry: PasswordEntry) {
        vault = vault.copy(passwords = vault.passwords + entry)
        saveVault()
    }

    fun updateEntry(entry: PasswordEntry) {
        vault = vault.copy(passwords = vault.passwords.map { if (it.id == entry.id) entry else it })
        saveVault()
    }

    fun deleteEntry(entry: PasswordEntry) {
        vault = vault.copy(
            passwords = vault.passwords.filter { it.id != entry.id },
            trash = vault.trash + entry
        )
        saveVault()
    }

    fun copyToClipboard(context: android.content.Context, text: String) {
        val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val clip = android.content.ClipData.newPlainText("Password", text)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            clip.description.extras = android.os.PersistableBundle().apply {
                putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }
        clipboard.setPrimaryClip(clip)
        viewModelScope.launch {
            kotlinx.coroutines.delay(30000)
            if (clipboard.primaryClip?.getItemAt(0)?.text == text) {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                    clipboard.clearPrimaryClip()
                } else {
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("", ""))
                }
            }
        }
    }

    fun exportVault(uri: android.net.Uri, context: android.content.Context, exportPassword: String) {
        viewModelScope.launch {
            try {
                val json = gson.toJson(vault)
                val encrypted = vaultRepository.exportEncryptedVault(json, exportPassword)
                context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(encrypted) }
            } catch (e: Exception) {
                _error.value = "Export failed: ${e.message}"
            }
        }
    }

    fun importVault(uri: android.net.Uri, context: android.content.Context, importPassword: String) {
        viewModelScope.launch {
            try {
                val encrypted = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: return@launch
                val json = vaultRepository.decryptImportedVault(encrypted, importPassword)
                val importedVault = gson.fromJson(json, Vault::class.java)
                val newPasswords = (vault.passwords + importedVault.passwords).distinctBy { it.id }
                vault = vault.copy(passwords = newPasswords)
                saveVault()
            } catch (e: Exception) {
                _error.value = "Import failed: ${e.message}"
            }
        }
    }

    fun importCsv(uri: android.net.Uri, context: android.content.Context) {
        viewModelScope.launch {
            try {
                val csvData = context.contentResolver.openInputStream(uri)?.bufferedReader()?.readLines() ?: return@launch
                val imported = csvData.drop(1).mapNotNull { line ->
                    val parts = line.split(",")
                    if (parts.size >= 3) {
                        PasswordEntry(
                            id = java.util.UUID.randomUUID().toString(),
                            app = parts[0],
                            username = parts[1],
                            password = parts[2],
                            link = if (parts.size > 3) parts[3] else "",
                            notes = if (parts.size > 4) parts[4] else ""
                        )
                    } else null
                }
                vault = vault.copy(passwords = vault.passwords + imported)
                saveVault()
            } catch (e: Exception) {
                _error.value = "CSV Import failed: ${e.message}"
            }
        }
    }
}
