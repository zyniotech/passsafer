package com.example.passsafer.data.model

import java.util.UUID

data class PasswordEntry(
    val id: String = UUID.randomUUID().toString(),
    val app: String = "",
    val username: String = "",
    val password: String = "",
    val link: String = "",
    val notes: String = "",
    val folder: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
