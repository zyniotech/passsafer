package com.example.passsafer.data.sync

import android.content.Context
import android.net.wifi.WifiManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.example.passsafer.data.crypto.CryptoManager
import com.example.passsafer.data.crypto.SyncCrypto
import com.example.passsafer.data.repository.VaultRepository
import com.google.gson.Gson
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetAddress
import java.net.Socket
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncClient @Inject constructor(
    @ApplicationContext private val context: Context,
    private val cryptoManager: CryptoManager,
    private val vaultRepository: VaultRepository
) {
    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val serviceType = "_passsafer-sync._tcp."
    private val gson = Gson()

    fun discoverServices(): Flow<NsdServiceInfo> = callbackFlow {
        var multicastLock: WifiManager.MulticastLock? = null
        try {
            multicastLock = wifiManager?.createMulticastLock("PassSaferMulticastLock")
            multicastLock?.setReferenceCounted(true)
            multicastLock?.acquire()
        } catch (e: Exception) {
            e.printStackTrace()
        }

        val discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {}
            override fun onServiceFound(service: NsdServiceInfo) {
                if (service.serviceType.contains("_passsafer-sync")) {
                    resolveServiceSafely(service) { resolved ->
                        trySend(resolved)
                    }
                }
            }
            override fun onServiceLost(service: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                runCatching { nsdManager.stopServiceDiscovery(this) }
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }

        try {
            nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        awaitClose {
            runCatching { nsdManager.stopServiceDiscovery(discoveryListener) }
            runCatching {
                if (multicastLock?.isHeld == true) {
                    multicastLock.release()
                }
            }
        }
    }

    private fun resolveServiceSafely(service: NsdServiceInfo, onResolved: (NsdServiceInfo) -> Unit) {
        val listener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                onResolved(serviceInfo)
            }
        }
        runCatching {
            nsdManager.resolveService(service, listener)
        }
    }

    suspend fun connectAndSync(
        hostAddress: String,
        port: Int,
        pin: String,
        masterPasswordString: String
    ) = withContext(Dispatchers.IO) {
        val cleanPin = pin.trim()
        val cleanHost = hostAddress.trim()
        android.util.Log.i("PassSaferSync", "Starting sync with $cleanHost:$port, PIN: $cleanPin")
        var socket: Socket? = null
        try {
            val address = InetAddress.getByName(cleanHost)
            socket = Socket()
            socket.connect(java.net.InetSocketAddress(address, port), 8000)
            socket.soTimeout = 15000
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
            val writer = PrintWriter(socket.getOutputStream(), true)

            val syncCrypto = SyncCrypto()
            android.util.Log.i("PassSaferSync", "Sending hello handshake...")
            val helloMsg = mapOf("type" to "hello", "publicKey" to syncCrypto.getPublicKeyHex())
            writer.println(gson.toJson(helloMsg))

            val helloReplyStr = reader.readLine() ?: throw Exception("Desktop disconnected during handshake.")
            val helloReply = gson.fromJson(helloReplyStr, Map::class.java)
            if (helloReply["type"] != "hello_reply") throw Exception("Invalid handshake response from Desktop.")
            
            val sessionKey = syncCrypto.computeSessionKey(cleanPin)
            android.util.Log.i("PassSaferSync", "Session key computed: ${sessionKey.take(16)}... Sending auth...")

            val authMsg = mapOf("type" to "auth", "pin" to cleanPin)
            writer.println(gson.toJson(authMsg))

            val authReplyStr = reader.readLine() ?: throw Exception("Desktop disconnected during PIN verification.")
            val authReply = gson.fromJson(authReplyStr, Map::class.java)
            if (authReply["success"] != true) throw Exception("Incorrect PIN. Please try again.")

            android.util.Log.i("PassSaferSync", "Auth successful! Reading local vault...")
            val salt = vaultRepository.getSalt("master.mh")
            val localVaultStr = if (salt != null && masterPasswordString.isNotEmpty()) {
                vaultRepository.readVault("passwords.pw", masterPasswordString, salt) ?: "{\"passwords\":[],\"folders\":[],\"trash\":[]}"
            } else {
                "{\"passwords\":[],\"folders\":[],\"trash\":[]}"
            }
            val localVaultMap = mapOf("pw" to gson.fromJson(localVaultStr, Map::class.java))
            val encryptedLocalVault = cryptoManager.encryptExport(gson.toJson(localVaultMap), sessionKey)

            android.util.Log.i("PassSaferSync", "Sending sync payload (${encryptedLocalVault.length} chars)...")
            val syncMsg = mapOf("type" to "sync", "data" to encryptedLocalVault)
            writer.println(gson.toJson(syncMsg))

            socket.soTimeout = 60000
            val syncReplyStr = reader.readLine() ?: throw Exception("Desktop disconnected during sync.")
            val syncReply = gson.fromJson(syncReplyStr, Map::class.java)
            if (syncReply["success"] != true) throw Exception(syncReply["error"]?.toString() ?: "Desktop rejected sync data.")

            val encryptedRemoteVault = syncReply["data"] as String
            android.util.Log.i("PassSaferSync", "Received sync reply (${encryptedRemoteVault.length} chars). Decrypting...")
            val decryptedRemoteVaultJson = cryptoManager.decryptExport(encryptedRemoteVault, sessionKey)
            android.util.Log.i("PassSaferSync", "Decrypted successfully! Parsing and saving...")
            
            val remoteVaultMap = gson.fromJson(decryptedRemoteVaultJson, Map::class.java)
            val remotePwMap = remoteVaultMap["pw"] ?: mapOf("passwords" to emptyList<Any>(), "folders" to emptyList<Any>(), "trash" to emptyList<Any>())
            val finalVaultJson = gson.toJson(remotePwMap)

            if (salt != null && masterPasswordString.isNotEmpty()) {
                vaultRepository.saveVault("passwords.pw", finalVaultJson, masterPasswordString, salt)
            }
            android.util.Log.i("PassSaferSync", "Sync completed and saved successfully!")
        } catch (e: Exception) {
            android.util.Log.e("PassSaferSync", "Sync failed with error: ${e.message}", e)
            throw e
        } finally {
            runCatching { socket?.close() }
        }
    }
}
