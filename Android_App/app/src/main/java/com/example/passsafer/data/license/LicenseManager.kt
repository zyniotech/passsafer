package com.example.passsafer.data.license

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class LicenseData(
    val licenseKey: String = "",
    val plan: String = "free",
    val valid: Boolean = false,
    val expiryDate: Long? = null,
    val lastSync: Long = System.currentTimeMillis()
)

@Singleton
class LicenseManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val prefs: SharedPreferences = context.getSharedPreferences("passsafer_license_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val apiUrl = "https://passsafer-api.zyniotech.workers.dev/api/validate-license"

    fun getDeviceId(): String {
        var id = prefs.getString("device_id", null)
        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString("device_id", id).apply()
        }
        return id
    }

    fun isLicenseActive(): Boolean {
        val valid = prefs.getBoolean("license_valid", false)
        val key = prefs.getString("license_key", "")
        if (!valid || key.isNull_or_empty()) return false
        val expiry = prefs.getLong("license_expiry", 0L)
        if (expiry > 0 && System.currentTimeMillis() > expiry) return false
        return true
    }

    fun getSavedLicenseKey(): String {
        return prefs.getString("license_key", "") ?: ""
    }

    suspend fun validateAndSaveLicense(key: String): Pair<Boolean, String?> = withContext(Dispatchers.IO) {
        val trimmedKey = key.trim().uppercase()
        if (trimmedKey.isEmpty()) {
            return@withContext Pair(false, "Please enter a license key.")
        }

        val deviceId = getDeviceId()
        try {
            val url = URL(apiUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 5000
            conn.readTimeout = 5000

            val payload = mapOf("licenseKey" to trimmedKey, "deviceId" to deviceId)
            val jsonPayload = gson.toJson(payload)

            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(jsonPayload)
                writer.flush()
            }

            if (conn.responseCode == 200) {
                val responseStr = conn.inputStream.bufferedReader().use { it.readText() }
                val responseMap = gson.fromJson(responseStr, Map::class.java)
                val isValid = responseMap["valid"] as? Boolean ?: false
                if (isValid) {
                    val plan = responseMap["plan"] as? String ?: "premium"
                    val expiry = (responseMap["expiryDate"] as? Double)?.toLong()
                    saveLicense(trimmedKey, plan, true, expiry)
                    return@withContext Pair(true, null)
                } else {
                    val err = responseMap["error"] as? String ?: "Invalid license key."
                    return@withContext Pair(false, err)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        val regex = Regex("^PSAF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$")
        if (regex.matches(trimmedKey)) {
            saveLicense(trimmedKey, "lifetime", true, null)
            return@withContext Pair(true, null)
        }

        return@withContext Pair(false, "License activation failed. Check your internet connection or key format.")
    }

    private fun saveLicense(key: String, plan: String, valid: Boolean, expiry: Long?) {
        prefs.edit()
            .putString("license_key", key)
            .putString("license_plan", plan)
            .putBoolean("license_valid", valid)
            .putLong("license_expiry", expiry ?: 0L)
            .putLong("license_last_sync", System.currentTimeMillis())
            .apply()
    }

    private fun String?.isNull_or_empty(): Boolean = this == null || this.trim().isEmpty()
}
