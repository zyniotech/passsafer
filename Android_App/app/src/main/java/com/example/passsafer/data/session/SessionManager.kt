package com.example.passsafer.data.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class SessionManager {
    private val _masterPassword = MutableStateFlow<String?>(null)
    val masterPassword: StateFlow<String?> = _masterPassword.asStateFlow()

    fun setMasterPassword(password: String?) {
        _masterPassword.value = password
    }

    fun clearSession() {
        _masterPassword.value = null
    }
}
