package com.example.passsafer.ui.sync

import android.net.nsd.NsdServiceInfo
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.passsafer.data.session.SessionManager
import com.example.passsafer.data.sync.SyncClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SyncViewModel @Inject constructor(
    private val syncClient: SyncClient,
    private val sessionManager: SessionManager
) : ViewModel() {

    private val _discoveredDevices = MutableStateFlow<List<NsdServiceInfo>>(emptyList())
    val discoveredDevices: StateFlow<List<NsdServiceInfo>> = _discoveredDevices.asStateFlow()

    private val _syncState = MutableStateFlow("idle")
    val syncState: StateFlow<String> = _syncState.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    fun startDiscovery() {
        viewModelScope.launch {
            _syncState.value = "discovering"
            _errorMessage.value = null
            runCatching {
                syncClient.discoverServices().collect { service ->
                    val currentList = _discoveredDevices.value.toMutableList()
                    val existingIndex = currentList.indexOfFirst { it.serviceName == service.serviceName }
                    if (existingIndex >= 0) {
                        currentList[existingIndex] = service
                    } else {
                        currentList.add(service)
                    }
                    _discoveredDevices.value = currentList
                }
            }.onFailure {
                _errorMessage.value = "Network discovery issue: ${it.localizedMessage}"
            }
        }
    }

    fun connectAndSync(device: NsdServiceInfo, pin: String) {
        val host = device.host?.hostAddress
        val port = device.port
        if (host == null) {
            _syncState.value = "error"
            _errorMessage.value = "Device IP address not resolved yet. Try again in a few seconds."
            return
        }
        connectAndSyncDirect(host, port, pin)
    }

    fun connectAndSyncDirect(host: String, port: Int, pin: String) {
        val masterPassword = sessionManager.masterPassword.value ?: ""

        viewModelScope.launch {
            _syncState.value = "syncing"
            _errorMessage.value = null
            try {
                syncClient.connectAndSync(host, port, pin, masterPassword)
                _syncState.value = "success"
            } catch (e: Exception) {
                _syncState.value = "error"
                _errorMessage.value = "Sync failed: ${e.localizedMessage ?: "Unknown error"}"
            }
        }
    }
}
