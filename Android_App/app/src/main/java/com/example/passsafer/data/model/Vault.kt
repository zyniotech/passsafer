package com.example.passsafer.data.model

import java.util.UUID

data class Vault(
    val passwords: List<PasswordEntry> = emptyList(),
    val folders: List<Folder> = emptyList(),
    val trash: List<PasswordEntry> = emptyList()
)

data class Folder(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "",
    val color: String = "#4A90D9",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

