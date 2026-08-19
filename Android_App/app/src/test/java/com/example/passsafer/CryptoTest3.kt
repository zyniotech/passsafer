package com.example.passsafer

import org.junit.Test
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class CryptoTest3 {
    @Test
    fun testAesEncryption() {
        val password = "001122"
        val text = "test"
        
        // Fixed Salt
        val saltHex = "228724d827483733d2bd08a10714c5839499c0271e988a973e8950c8bb83a838"
        val salt = saltHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        
        // Fixed IV
        val ivHex = "46c86561fe12b2a865e95b23"
        val iv = ivHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password.toCharArray(), salt, 100000, 256)
        val key = factory.generateSecret(spec).encoded
        val secretKey = SecretKeySpec(key, "AES")
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(128, iv)
        
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, gcmSpec)
        val encryptedAndTag = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        
        val encrypted = encryptedAndTag.dropLast(16).toByteArray()
        val authTag = encryptedAndTag.takeLast(16).toByteArray()
        
        val result = "v2:${salt.toHexString()}:${iv.toHexString()}:${authTag.toHexString()}:${encrypted.toHexString()}"
        println("Java Encrypted Payload: $result")
    }

    private fun ByteArray.toHexString(): String {
        return joinToString("") { "%02x".format(it) }
    }
}
