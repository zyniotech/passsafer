package com.example.passsafer

import org.junit.Assert.assertEquals
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class CryptoTest4 {
    @Test
    fun testAesDecryption() {
        val payload = "v2:228724d827483733d2bd08a10714c5839499c0271e988a973e8950c8bb83a838:46c86561fe12b2a865e95b23:5ae41037b6f1898bd1ed013b25a022a3:feed663e"
        val password = "001122"
        
        val parts = payload.split(":")
        val salt = parts[1].chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val iv = parts[2].chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val authTag = parts[3].chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val encrypted = parts[4].chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password.toCharArray(), salt, 100000, 256)
        val key = factory.generateSecret(spec).encoded
        val secretKey = SecretKeySpec(key, "AES")
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmSpec)
        
        val encryptedAndTag = encrypted + authTag
        val decrypted = cipher.doFinal(encryptedAndTag)
        
        val result = String(decrypted, Charsets.UTF_8)
        println("Java Decrypted: $result")
        assertEquals("test", result)
    }
}
