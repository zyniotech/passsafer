package com.example.passsafer.data.model

data class Vault(
    val passwords: List<PasswordEntry> = emptyList(),
    val folders: List<Folder> = emptyList(),
    val trash: List<PasswordEntry> = emptyList()
)

data class Folder(
    val name: String = "",
    val color: String = "#4A90D9"
)
