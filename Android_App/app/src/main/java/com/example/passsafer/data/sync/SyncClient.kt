package com.example.passsafer.data.sync

import android.content.Context
import android.net.wifi.WifiManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import com.example.passsafer.data.crypto.CryptoManager
import com.example.passsafer.data.crypto.SyncCrypto
import com.example.passsafer.data.repository.VaultRepository
import com.google.gson.Gson
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
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

        var udpSocket: DatagramSocket? = null
        val udpJob = launch(Dispatchers.IO) {
            try {
                val sock = try {
                    MulticastSocket(41234).apply {
                        reuseAddress = true
                        runCatching { joinGroup(InetAddress.getByName("224.0.0.251")) }
                    }
                } catch (_: Exception) {
                    DatagramSocket(null).apply {
                        reuseAddress = true
                        bind(InetSocketAddress(41234))
                    }
                }
                udpSocket = sock
                val buf = ByteArray(2048)
                while (isActive && !sock.isClosed) {
                    val packet = DatagramPacket(buf, buf.size)
                    sock.receive(packet)
                    val msg = String(packet.data, 0, packet.length, Charsets.UTF_8).trim()
                    val data = runCatching { gson.fromJson(msg, Map::class.java) }.getOrNull() ?: continue
                    val svc = data["service"]?.toString() ?: ""
                    val portNum = (data["port"] as? Number)?.toInt() ?: 0
                    if (svc == "_passsafer-sync._tcp.local" && portNum > 0) {
                        val deviceName = data["device"]?.toString()?.takeIf { it.isNotBlank() }
                            ?: packet.address.hostAddress
                            ?: "PassSafer PC"
                        val info = NsdServiceInfo().apply {
                            serviceName = deviceName
                            serviceType = "_passsafer-sync._tcp."
                            port = portNum
                            @Suppress("DEPRECATION")
                            host = packet.address
                        }
                        trySend(info)
                    }
                }
            } catch (_: Exception) {
            }
        }

        awaitClose {
            udpJob.cancel()
            runCatching { udpSocket?.close() }
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
        var socket: Socket? = null
        try {
            val address = InetAddress.getByName(cleanHost)
            socket = Socket()
            socket.connect(InetSocketAddress(address, port), 8000)
            socket.soTimeout = 15000
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
            val writer = PrintWriter(socket.getOutputStream(), true)

            val syncCrypto = SyncCrypto()
            val deviceLabel = "${Build.MANUFACTURER} ${Build.MODEL}".trim().ifEmpty { "Android" }
            val helloMsg = mapOf(
                "type" to "hello",
                "publicKey" to syncCrypto.getPublicKeyHex(),
                "deviceName" to deviceLabel
            )
            writer.println(gson.toJson(helloMsg))

            val helloReplyStr = reader.readLine() ?: throw Exception("Desktop disconnected during handshake.")
            val helloReply = gson.fromJson(helloReplyStr, Map::class.java)
            if (helloReply["type"] != "hello_reply") throw Exception("Invalid handshake response from Desktop.")

            val remotePublicKey = helloReply["publicKey"] as? String
            val sessionKey = syncCrypto.computeSessionKey(cleanPin, remotePublicKey)
            val authProof = syncCrypto.computeAuthProof(sessionKey)

            val authMsg = mapOf("type" to "auth", "proof" to authProof)
            writer.println(gson.toJson(authMsg))

            val authReplyStr = reader.readLine() ?: throw Exception("Desktop disconnected during PIN verification.")
            val authReply = gson.fromJson(authReplyStr, Map::class.java)
            if (authReply["success"] != true) throw Exception("Incorrect PIN. Please try again.")

            val salt = vaultRepository.getSalt("master.mh")
            val localVaultMap = mutableMapOf<String, Any>()
            val localPwStr = if (salt != null && masterPasswordString.isNotEmpty()) {
                vaultRepository.readVault("passwords.pw", masterPasswordString, salt)
                    ?: "{\"passwords\":[],\"folders\":[],\"trash\":[]}"
            } else {
                "{\"passwords\":[],\"folders\":[],\"trash\":[]}"
            }
            localVaultMap["pw"] = gson.fromJson(localPwStr, Map::class.java)

            if (salt != null && masterPasswordString.isNotEmpty()) {
                val extraFiles = listOf(
                    "ids.id" to "id",
                    "docs.doc" to "doc",
                    "cards.card" to "card",
                    "reports.report" to "report"
                )
                for ((fileName, keyName) in extraFiles) {
                    val content = vaultRepository.readVault(fileName, masterPasswordString, salt)
                    if (!content.isNullOrBlank()) {
                        runCatching {
                            localVaultMap[keyName] = gson.fromJson(content, List::class.java)
                        }
                    }
                }
            }

            val encryptedLocalVault = cryptoManager.encryptExport(gson.toJson(localVaultMap), sessionKey)
            val syncMsg = mapOf("type" to "sync", "data" to encryptedLocalVault)
            writer.println(gson.toJson(syncMsg))

            socket.soTimeout = 60000
            val syncReplyStr = reader.readLine() ?: throw Exception("Desktop disconnected during sync.")
            val syncReply = gson.fromJson(syncReplyStr, Map::class.java)
            if (syncReply["success"] != true) throw Exception(syncReply["error"]?.toString() ?: "Desktop rejected sync data.")

            val encryptedRemoteVault = syncReply["data"] as? String
            if (!encryptedRemoteVault.isNullOrBlank() && salt != null && masterPasswordString.isNotEmpty()) {
                val decryptedRemoteVaultJson = cryptoManager.decryptExport(encryptedRemoteVault, sessionKey)
                val remoteVaultMap = gson.fromJson(decryptedRemoteVaultJson, Map::class.java)
                val remotePwMap = remoteVaultMap["pw"]
                if (remotePwMap != null) {
                    val finalVaultJson = gson.toJson(remotePwMap)
                    vaultRepository.saveVault("passwords.pw", finalVaultJson, masterPasswordString, salt)
                }
                val extraFiles = listOf(
                    "ids.id" to "id",
                    "docs.doc" to "doc",
                    "cards.card" to "card",
                    "reports.report" to "report"
                )
                for ((fileName, keyName) in extraFiles) {
                    val sectionData = remoteVaultMap[keyName]
                    if (sectionData != null) {
                        vaultRepository.saveVault(fileName, gson.toJson(sectionData), masterPasswordString, salt)
                    }
                }
            }
        } catch (e: Exception) {
            throw e
        } finally {
            runCatching { socket?.close() }
        }
    }
}

