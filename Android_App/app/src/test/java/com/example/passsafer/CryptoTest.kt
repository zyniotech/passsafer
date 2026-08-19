package com.example.passsafer

import com.example.passsafer.data.crypto.CryptoManager
import org.junit.Assert.assertEquals
import org.junit.Test
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class CryptoTest {
    @Test
    fun testPBKDF2() {
        val password = "616263" // hex string
        val saltHex = "73616c74"
        val salt = saltHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password.toCharArray(), salt, 100000, 256)
        val key = factory.generateSecret(spec).encoded
        
        val keyHex = key.joinToString("") { "%02x".format(it) }
        println("Generated PBKDF2 Key: $keyHex")
        // Expected from Node.js: bf951c3f0f14b4dafdcc3e59d27d0fff
        assertEquals("bf951c3f0f14b4dafdcc3e59d27d0fff", keyHex)
    }

    @Test
    fun testScrypt() {
        // Node.js scryptSync(Buffer.from('001122', 'hex'), '123456', 32, { N: 16384, r: 8, p: 1 }) -> 5e91129b0a8803cf8240ef14ccce8cf3dcf1c4c1143c683b584093952ba2858b
        val sharedSecretBytes = "001122".chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val pin = "123456"
        val sessionKeyBytes = org.bouncycastle.crypto.generators.SCrypt.generate(
            sharedSecretBytes,
            pin.toByteArray(Charsets.UTF_8),
            16384,
            8,
            1,
            32
        )
        val keyHex = sessionKeyBytes.joinToString("") { "%02x".format(it) }
        println("Generated Scrypt Key: $keyHex")
        assertEquals("5e91129b0a8803cf8240ef14ccce8cf3dcf1c4c1143c683b584093952ba2858b", keyHex)
    }
}
