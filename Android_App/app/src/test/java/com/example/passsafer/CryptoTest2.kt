package com.example.passsafer

import org.bouncycastle.crypto.agreement.ECDHBasicAgreement
import org.bouncycastle.crypto.params.ECDomainParameters
import org.bouncycastle.crypto.params.ECPrivateKeyParameters
import org.bouncycastle.crypto.params.ECPublicKeyParameters
import org.bouncycastle.jce.ECNamedCurveTable
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigInteger

class CryptoTest2 {
    @Test
    fun testECDH() {
        val curveParams = ECNamedCurveTable.getParameterSpec("secp256r1")
        val domainParams = ECDomainParameters(
            curveParams.curve,
            curveParams.g,
            curveParams.n,
            curveParams.h
        )

        val aPrivHex = "5d82719f3768d4d6f227e3f47e0c226753370132a0f0ce27d5f04b2f649134be"
        val bPrivHex = "f683caca79d7cf798a436d7df0e54ea8a167abb9fc3444d075b98051230693b2"

        val aPrivBigInt = BigInteger(1, aPrivHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
        val bPrivBigInt = BigInteger(1, bPrivHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray())

        val aPrivParam = ECPrivateKeyParameters(aPrivBigInt, domainParams)
        val bPrivParam = ECPrivateKeyParameters(bPrivBigInt, domainParams)

        val aPubPoint = curveParams.g.multiply(aPrivBigInt).normalize()
        val bPubPoint = curveParams.g.multiply(bPrivBigInt).normalize()

        val aPubParam = ECPublicKeyParameters(aPubPoint, domainParams)
        val bPubParam = ECPublicKeyParameters(bPubPoint, domainParams)

        val agreement = ECDHBasicAgreement()
        agreement.init(aPrivParam)
        val sharedSecretBigInt = agreement.calculateAgreement(bPubParam)

        val rawSharedBytes = sharedSecretBigInt.toByteArray()
        val sharedSecretBytes = padToLength(rawSharedBytes, 32)
        
        val sharedHex = sharedSecretBytes.joinToString("") { "%02x".format(it) }
        println("Generated Shared Secret: $sharedHex")
        assertEquals("1e3d018a28cf775f0e727fc578788d9c292617aab4481536babb286533f38436", sharedHex)
    }

    private fun padToLength(array: ByteArray, length: Int): ByteArray {
        if (array.size == length) return array
        if (array.size > length) {
            return array.copyOfRange(array.size - length, array.size)
        }
        val result = ByteArray(length)
        System.arraycopy(array, 0, result, length - array.size, array.size)
        return result
    }
}
