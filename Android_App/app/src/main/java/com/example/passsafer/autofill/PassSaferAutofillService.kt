package com.example.passsafer.autofill

import android.app.PendingIntent
import android.content.Intent
import android.os.CancellationSignal
import android.service.autofill.*
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import com.example.passsafer.MainActivity
import com.example.passsafer.R
import com.example.passsafer.data.model.Vault
import com.example.passsafer.data.repository.VaultRepository
import com.example.passsafer.data.session.SessionManager
import com.google.gson.Gson
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject
import android.app.assist.AssistStructure

@AndroidEntryPoint
class PassSaferAutofillService : AutofillService() {
    @Inject
    lateinit var vaultRepository: VaultRepository

    @Inject
    lateinit var sessionManager: SessionManager

    private val serviceScope = CoroutineScope(Dispatchers.IO)
    private val gson = Gson()

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        val structure = request.fillContexts.last().structure
        val packageName = structure.activityComponent.packageName

        var usernameId: AutofillId? = null
        var passwordId: AutofillId? = null

        fun traverseNode(node: AssistStructure.ViewNode) {
            val hints = node.autofillHints
            if (hints != null) {
                if (hints.contains(android.view.View.AUTOFILL_HINT_USERNAME) || hints.contains(android.view.View.AUTOFILL_HINT_EMAIL_ADDRESS)) {
                    usernameId = node.autofillId
                }
                if (hints.contains(android.view.View.AUTOFILL_HINT_PASSWORD)) {
                    passwordId = node.autofillId
                }
            } else {
                val type = node.autofillType
                if (type == android.view.View.AUTOFILL_TYPE_TEXT) {
                    val inputType = node.inputType
                    val isPassword = (inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0 ||
                            (inputType and android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) != 0
                    if (isPassword) passwordId = node.autofillId
                    else if (usernameId == null) usernameId = node.autofillId
                }
            }
            for (i in 0 until node.childCount) {
                traverseNode(node.getChildAt(i))
            }
        }

        for (i in 0 until structure.windowNodeCount) {
            traverseNode(structure.getWindowNodeAt(i).rootViewNode)
        }

        val masterPassword = sessionManager.masterPassword.value
        if (masterPassword == null) {
            val intent = Intent(this, MainActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_CANCEL_CURRENT
            )
            val presentation = RemoteViews(this@PassSaferAutofillService.packageName, android.R.layout.simple_list_item_1)
            presentation.setTextViewText(android.R.id.text1, "Unlock PassSafer")
            val authDataset = Dataset.Builder()
                .setAuthentication(pendingIntent.intentSender)
                .setValue(usernameId ?: passwordId ?: return, AutofillValue.forText(""), presentation)
                .build()
            val response = FillResponse.Builder().addDataset(authDataset).build()
            callback.onSuccess(response)
            return
        }

        serviceScope.launch {
            try {
                val salt = vaultRepository.getSalt("master.mh")
                if (salt != null) {
                    val json = vaultRepository.readVault("passwords.pw", masterPassword, salt)
                    if (json != null) {
                        val vault = gson.fromJson(json, Vault::class.java)
                        val matchingEntries = vault.passwords.filter {
                            it.app.contains(packageName, ignoreCase = true) || packageName.contains(it.app, ignoreCase = true)
                        }
                        
                        val responseBuilder = FillResponse.Builder()
                        if (matchingEntries.isEmpty()) {
                            callback.onSuccess(null)
                            return@launch
                        }

                        for (entry in matchingEntries) {
                            val presentation = RemoteViews(this@PassSaferAutofillService.packageName, android.R.layout.simple_list_item_1)
                            presentation.setTextViewText(android.R.id.text1, "${entry.app} – ${entry.username}")

                            val datasetBuilder = Dataset.Builder()
                            if (usernameId != null) datasetBuilder.setValue(usernameId!!, AutofillValue.forText(entry.username), presentation)
                            if (passwordId != null) datasetBuilder.setValue(passwordId!!, AutofillValue.forText(entry.password), presentation)

                            responseBuilder.addDataset(datasetBuilder.build())
                        }

                        val saveIds = listOfNotNull(usernameId, passwordId).toTypedArray()
                        if (saveIds.isNotEmpty()) {
                            val saveInfo = SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD, saveIds).build()
                            responseBuilder.setSaveInfo(saveInfo)
                        }

                        callback.onSuccess(responseBuilder.build())
                    } else {
                        callback.onSuccess(null)
                    }
                } else {
                    callback.onSuccess(null)
                }
            } catch (e: Exception) {
                callback.onFailure(e.message)
            }
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.last().structure
        val packageName = structure.activityComponent.packageName

        var usernameValue: String? = null
        var passwordValue: String? = null

        fun traverseNodeForValues(node: AssistStructure.ViewNode) {
            val hints = node.autofillHints
            val value = node.autofillValue
            if (value != null && value.isText) {
                val text = value.textValue.toString()
                if (hints != null) {
                    when {
                        hints.contains(android.view.View.AUTOFILL_HINT_USERNAME) ||
                        hints.contains(android.view.View.AUTOFILL_HINT_EMAIL_ADDRESS) -> usernameValue = text
                        hints.contains(android.view.View.AUTOFILL_HINT_PASSWORD) -> passwordValue = text
                    }
                } else {
                    val inputType = node.inputType
                    val isPassword = (inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0 ||
                            (inputType and android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) != 0
                    if (isPassword) passwordValue = text
                    else if (usernameValue == null && text.isNotEmpty()) usernameValue = text
                }
            }
            for (i in 0 until node.childCount) traverseNodeForValues(node.getChildAt(i))
        }

        for (i in 0 until structure.windowNodeCount) {
            traverseNodeForValues(structure.getWindowNodeAt(i).rootViewNode)
        }

        val masterPassword = sessionManager.masterPassword.value ?: run {
            callback.onSuccess()
            return
        }

        val uName = usernameValue ?: ""
        val pwd = passwordValue ?: run { callback.onSuccess(); return }

        serviceScope.launch {
            try {
                val salt = vaultRepository.getSalt("master.mh") ?: return@launch
                val json = vaultRepository.readVault("passwords.pw", masterPassword, salt)
                val vault = if (json != null) gson.fromJson(json, com.example.passsafer.data.model.Vault::class.java) else com.example.passsafer.data.model.Vault()
                val newEntry = com.example.passsafer.data.model.PasswordEntry(
                    app = packageName,
                    username = uName,
                    password = pwd
                )
                val updated = vault.copy(passwords = vault.passwords + newEntry)
                vaultRepository.saveVault("passwords.pw", gson.toJson(updated), masterPassword, salt)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        callback.onSuccess()
    }
}
