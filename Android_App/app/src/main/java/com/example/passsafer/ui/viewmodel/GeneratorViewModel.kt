package com.example.passsafer.ui.viewmodel

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

@HiltViewModel
class GeneratorViewModel @Inject constructor() : ViewModel() {
    private val _generatedPassword = MutableStateFlow("")
    val generatedPassword: StateFlow<String> = _generatedPassword.asStateFlow()
    
    fun generatePassword(length: Int, useUpper: Boolean, useLower: Boolean, useDigits: Boolean, useSpecial: Boolean) {
        val upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        val lower = "abcdefghijklmnopqrstuvwxyz"
        val digits = "0123456789"
        val special = "!@#$%^&*()_+-=[]{}|;:,.<>?"
        
        var chars = ""
        if (useUpper) chars += upper
        if (useLower) chars += lower
        if (useDigits) chars += digits
        if (useSpecial) chars += special
        
        if (chars.isEmpty()) {
            _generatedPassword.value = ""
            return
        }

        val result = StringBuilder(length)
        if (useUpper) result.append(upper.random())
        if (useLower) result.append(lower.random())
        if (useDigits) result.append(digits.random())
        if (useSpecial) result.append(special.random())
        
        while (result.length < length) {
            result.append(chars.random())
        }
        
        _generatedPassword.value = result.toList().shuffled().joinToString("")
    }

    fun copyToClipboard(context: android.content.Context, text: String) {
        val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("", text))
    }
}
