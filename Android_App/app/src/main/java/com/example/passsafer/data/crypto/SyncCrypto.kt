package com.example.passsafer.data.crypto

import org.bouncycastle.crypto.generators.ECKeyPairGenerator
import org.bouncycastle.crypto.params.ECDomainParameters
import org.bouncycastle.crypto.params.ECKeyGenerationParameters
import org.bouncycastle.crypto.params.ECPrivateKeyParameters
import org.bouncycastle.crypto.params.ECPublicKeyParameters
import org.bouncycastle.jce.ECNamedCurveTable
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class SyncCrypto {
    private val curveParams = ECNamedCurveTable.getParameterSpec("secp256r1")
    private val domainParams = ECDomainParameters(
        curveParams.curve,
        curveParams.g,
        curveParams.n,
        curveParams.h
    )

    private val privateKey: ECPrivateKeyParameters
    private val publicKeyHex: String

    init {
        val keyGen = ECKeyPairGenerator()
        keyGen.init(ECKeyGenerationParameters(domainParams, SecureRandom()))
        val pair = keyGen.generateKeyPair()
        privateKey = pair.private as ECPrivateKeyParameters
        val pubPoint = (pair.public as ECPublicKeyParameters).q
        publicKeyHex = pubPoint.getEncoded(false).joinToString("") { "%02x".format(it) }
    }

    fun getPublicKeyHex(): String = publicKeyHex

    fun computeSessionKey(pin: String, remotePublicKeyHex: String? = null): String {
        val secretHex = if (!remotePublicKeyHex.isNullOrBlank()) {
            try {
                val remoteBytes = remotePublicKeyHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                val remotePoint = domainParams.curve.decodePoint(remoteBytes)
                val sharedPoint = remotePoint.multiply(privateKey.d).normalize()
                val sharedSecretBytes = sharedPoint.affineXCoord.encoded
                sharedSecretBytes.joinToString("") { "%02x".format(it) }
            } catch (e: Exception) {
                ""
            }
        } else {
            ""
        }
        val combinedPassword = (pin + secretHex).toCharArray()
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(combinedPassword, "PassSaferSync2024".toByteArray(Charsets.UTF_8), 100000, 256)
        val keyBytes = factory.generateSecret(spec).encoded
        return keyBytes.joinToString("") { "%02x".format(it) }
    }

    fun computeAuthProof(sessionKeyHex: String): String {
        val keyBytes = sessionKeyHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        val digest = mac.doFinal("PassSaferAuthProof".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
