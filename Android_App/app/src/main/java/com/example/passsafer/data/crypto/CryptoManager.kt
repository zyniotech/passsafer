package com.example.passsafer.data.crypto

import org.bouncycastle.crypto.generators.SCrypt
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class CryptoManager {

    fun hashPassword(password: String, salt: String): String {
        val derivedKey = SCrypt.generate(
            password.toByteArray(Charsets.UTF_8),
            salt.toByteArray(Charsets.UTF_8),
            16384,
            8,
            1,
            64
        )
        return derivedKey.toHexString()
    }

    fun verifyPassword(password: String, hash: String, salt: String): Boolean {
        val newHash = hashPassword(password, salt)
        return MessageDigest.isEqual(newHash.toByteArray(), hash.toByteArray())
    }

    fun deriveKey(password: String, salt: String): ByteArray {
        return SCrypt.generate(
            password.toByteArray(Charsets.UTF_8),
            salt.toByteArray(Charsets.UTF_8),
            16384,
            8,
            1,
            32
        )
    }

    fun encrypt(text: String, password: String, salt: String): String {
        val key = deriveKey(password, salt)
        val secretKey = SecretKeySpec(key, "AES")
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val iv = ByteArray(12)
        SecureRandom().nextBytes(iv)
        val spec = GCMParameterSpec(128, iv)
        
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)
        val encryptedAndTag = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        
        val encrypted = encryptedAndTag.dropLast(16).toByteArray()
        val authTag = encryptedAndTag.takeLast(16).toByteArray()
        
        return "v2:${iv.toHexString()}:${authTag.toHexString()}:${encrypted.toHexString()}"
    }

    fun decrypt(encryptedData: String, password: String, salt: String): String {
        val parts = encryptedData.split(":")
        if (parts.size != 4 || parts[0] != "v2") {
            throw IllegalArgumentException("Invalid data format")
        }
        
        val iv = parts[1].hexToByteArray()
        val authTag = parts[2].hexToByteArray()
        val encrypted = parts[3].hexToByteArray()
        
        val key = deriveKey(password, salt)
        val secretKey = SecretKeySpec(key, "AES")
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        
        val encryptedAndTag = encrypted + authTag
        val decrypted = cipher.doFinal(encryptedAndTag)
        
        return String(decrypted, Charsets.UTF_8)
    }

    fun encryptExport(text: String, password: String): String {
        val salt = ByteArray(32)
        SecureRandom().nextBytes(salt)
        
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password.toCharArray(), salt, 100000, 256)
        val key = factory.generateSecret(spec).encoded
        val secretKey = SecretKeySpec(key, "AES")
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val iv = ByteArray(12)
        SecureRandom().nextBytes(iv)
        val gcmSpec = GCMParameterSpec(128, iv)
        
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, gcmSpec)
        val encryptedAndTag = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        
        val encrypted = encryptedAndTag.dropLast(16).toByteArray()
        val authTag = encryptedAndTag.takeLast(16).toByteArray()
        
        return "v2:${salt.toHexString()}:${iv.toHexString()}:${authTag.toHexString()}:${encrypted.toHexString()}"
    }

    fun decryptExport(encryptedData: String, password: String): String {
        val parts = encryptedData.split(":")
        if (parts.size != 5 || parts[0] != "v2") {
            throw IllegalArgumentException("Invalid export data format")
        }
        
        val salt = parts[1].hexToByteArray()
        val iv = parts[2].hexToByteArray()
        val authTag = parts[3].hexToByteArray()
        val encrypted = parts[4].hexToByteArray()
        
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password.toCharArray(), salt, 100000, 256)
        val key = factory.generateSecret(spec).encoded
        val secretKey = SecretKeySpec(key, "AES")
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmSpec)
        
        val encryptedAndTag = encrypted + authTag
        val decrypted = cipher.doFinal(encryptedAndTag)
        
        return String(decrypted, Charsets.UTF_8)
    }

    fun generateSalt(): String {
        val salt = ByteArray(16)
        SecureRandom().nextBytes(salt)
        return salt.toHexString()
    }

    private fun ByteArray.toHexString(): String {
        return joinToString("") { "%02x".format(it) }
    }

    private fun String.hexToByteArray(): ByteArray {
        require(length % 2 == 0) { "Must have an even length" }
        return chunked(2)
            .map { it.toInt(16).toByte() }
            .toByteArray()
    }
}
