package com.example.passsafer.data.crypto

import org.bouncycastle.crypto.generators.ECKeyPairGenerator
import org.bouncycastle.crypto.params.ECDomainParameters
import org.bouncycastle.crypto.params.ECKeyGenerationParameters
import org.bouncycastle.crypto.params.ECPublicKeyParameters
import org.bouncycastle.jce.ECNamedCurveTable
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class SyncCrypto {
    private val curveParams = ECNamedCurveTable.getParameterSpec("secp256r1")
    private val domainParams = ECDomainParameters(
        curveParams.curve,
        curveParams.g,
        curveParams.n,
        curveParams.h
    )

    private val publicKeyHex: String

    init {
        val keyGen = ECKeyPairGenerator()
        keyGen.init(ECKeyGenerationParameters(domainParams, SecureRandom()))
        val pair = keyGen.generateKeyPair()
        val pubPoint = (pair.public as ECPublicKeyParameters).q
        publicKeyHex = pubPoint.getEncoded(false).joinToString("") { "%02x".format(it) }
    }

    fun getPublicKeyHex(): String = publicKeyHex

    fun computeSessionKey(pin: String): String {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(pin.toCharArray(), "PassSaferSync2024".toByteArray(Charsets.UTF_8), 100000, 256)
        val keyBytes = factory.generateSecret(spec).encoded
        return keyBytes.joinToString("") { "%02x".format(it) }
    }
}

