package com.example.passsafer.data.repository

import android.content.Context
import com.example.passsafer.data.crypto.CryptoManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

class VaultRepository(
    private val context: Context,
    private val cryptoManager: CryptoManager
) {
    private val mutex = Mutex()

    suspend fun saveVault(filename: String, data: String, password: String, salt: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val encrypted = cryptoManager.encrypt(data, password, salt)
            val file = File(context.filesDir, filename)
            file.writeText(encrypted)
        }
    }

    suspend fun readVault(filename: String, password: String, salt: String): String? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val file = File(context.filesDir, filename)
            if (!file.exists()) return@withContext null
            val encrypted = file.readText()
            return@withContext cryptoManager.decrypt(encrypted, password, salt)
        }
    }

    suspend fun saveHash(filename: String, password: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val salt = cryptoManager.generateSalt()
            val hash = cryptoManager.hashPassword(password, salt)
            val json = """{"hash":"${hash}","salt":"${salt}","kdf":"scrypt"}"""
            File(context.filesDir, filename).writeText(json)
        }
    }

    suspend fun verifyHash(filename: String, password: String): Boolean = withContext(Dispatchers.IO) {
        mutex.withLock {
            val file = File(context.filesDir, filename)
            if (!file.exists()) return@withContext false
            val content = file.readText()
            
            val hashRegex = """"hash"\s*:\s*"([^"]+)"""".toRegex()
            val saltRegex = """"salt"\s*:\s*"([^"]+)"""".toRegex()
            
            val hash = hashRegex.find(content)?.groupValues?.get(1) ?: return@withContext false
            val salt = saltRegex.find(content)?.groupValues?.get(1) ?: return@withContext false
            
            return@withContext cryptoManager.verifyPassword(password, hash, salt)
        }
    }

    suspend fun getSalt(filename: String): String? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val file = File(context.filesDir, filename)
            if (!file.exists()) return@withContext null
            val content = file.readText()
            val saltRegex = """"salt"\s*:\s*"([^"]+)"""".toRegex()
            return@withContext saltRegex.find(content)?.groupValues?.get(1)
        }
    }

    suspend fun getRawVaultJSON(filename: String, password: String, salt: String): String? = withContext(Dispatchers.IO) {
        readVault(filename, password, salt)
    }

    suspend fun exportEncryptedVault(json: String, passwordForExport: String): String = withContext(Dispatchers.IO) {
        cryptoManager.encryptExport(json, passwordForExport)
    }
    
    suspend fun decryptImportedVault(encryptedData: String, passwordForImport: String): String = withContext(Dispatchers.IO) {
        cryptoManager.decryptExport(encryptedData, passwordForImport)
    }
}
