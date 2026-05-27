/**
 * PassSafer – Background Service Worker (Manifest V3)
 *
 * Verwaltet den lokalen verschlüsselten Cache, PIN-basierte Entsperrung
 * und Synchronisation mit der Desktop-App via Native Messaging.
 *
 * Message-Handler für Content-Scripts:
 *   - Credentials abrufen, speichern, aktualisieren
 *   - Seiten ignorieren
 *   - Pending-Save-Status verwalten
 *
 * Message-Handler für Popup:
 *   - Vault-Status abfragen
 *   - PIN einrichten / entsperren / sperren
 *   - Sperr-Verhalten ändern
 *   - Synchronisation auslösen
 *   - Cache zurücksetzen
 */

// ─────────────────────────────────────────────
// Crypto-Modul importieren
// ─────────────────────────────────────────────

importScripts('crypto-utils.js');

// ─────────────────────────────────────────────
// 1. In-Memory-Zustand (wird bei Browser-Neustart gelöscht)
// ─────────────────────────────────────────────

/** Entschlüsseltes Master-Passwort – nur im Arbeitsspeicher */
let masterPassword = null;

/** Entschlüsselte Credential-Liste – nur im Arbeitsspeicher */
let decryptedCredentials = null;

/** Zeitpunkt der letzten Aktivität (für Timeout-Sperren) */
let lastActivityTimestamp = Date.now();

/** Flag ob die Desktop-App aktuell erreichbar ist */
let appConnected = false;

// ─────────────────────────────────────────────
// 2. Installation & Initialisierung
// ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  // Nur beim erstmaligen Installieren initialisieren, nicht bei Updates
  if (details.reason !== 'install') return;

  try {
    await chrome.storage.local.set({
      ignored_domains: [],
      pending_save: null,
      pin_lock_policy: 'browser_restart',
    });
    console.log('[PassSafer] Initialer Storage erfolgreich vorbereitet.');
  } catch (err) {
    console.error('[PassSafer] Fehler bei der Initialisierung des Storages:', err);
  }
});

// ─────────────────────────────────────────────
// 3. Inaktivitäts-Timer für Timeout-Sperren
// ─────────────────────────────────────────────

chrome.alarms.create('lock-check', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'lock-check') return;
  if (!masterPassword) return;

  const data = await chrome.storage.local.get('pin_lock_policy');
  const policy = data.pin_lock_policy || 'browser_restart';

  let timeoutMs = null;
  if (policy === 'timeout_15m') timeoutMs = 15 * 60 * 1000;
  if (policy === 'timeout_1h') timeoutMs = 60 * 60 * 1000;

  if (timeoutMs && (Date.now() - lastActivityTimestamp) > timeoutMs) {
    console.log('[PassSafer] Inaktivitäts-Timeout erreicht – Tresor wird gesperrt.');
    lockVault();
  }
});

// ─────────────────────────────────────────────
// 4. Hilfsfunktion: Basis-Domain (eTLD+1)
// ─────────────────────────────────────────────

/**
 * Extrahiert die Basis-Domain (eTLD+1) aus einem Hostnamen.
 * Berücksichtigt gängige zweiteilige TLDs wie .co.uk, .com.au, .co.jp.
 *
 * @param {string} hostname – z. B. "www.github.com" oder "login.bbc.co.uk"
 * @returns {string} – z. B. "github.com" oder "bbc.co.uk"
 */
function getBaseDomain(hostname) {
  // Bekannte zweiteilige TLD-Suffixe
  const DOUBLE_TLDS = ['co.uk', 'com.au', 'co.jp', 'co.kr', 'com.br', 'co.in', 'org.uk', 'net.au', 'co.nz'];

  const parts = hostname.replace(/\.$/, '').split('.');

  // Prüfen, ob die letzten beiden Teile ein bekanntes Doppel-TLD bilden
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join('.');
    if (DOUBLE_TLDS.includes(lastTwo)) {
      // Bei Doppel-TLDs die letzten 3 Teile nehmen
      return parts.slice(-3).join('.');
    }
  }

  // Standardfall: letzte 2 Teile
  return parts.slice(-2).join('.');
}

// ─────────────────────────────────────────────
// 5. Vault-Verwaltung
// ─────────────────────────────────────────────

/** Sperrt den Tresor – löscht das Master-Passwort und die Credentials aus dem Speicher. */
function lockVault() {
  masterPassword = null;
  decryptedCredentials = null;
  console.log('[PassSafer] Tresor gesperrt.');
}

/**
 * Prüft ob der Tresor aktuell entsperrt ist (Master-Passwort im Speicher).
 * @returns {boolean}
 */
function isUnlocked() {
  return masterPassword !== null && decryptedCredentials !== null;
}

/**
 * Aktualisiert den Aktivitäts-Zeitstempel (für Timeout-Sperren).
 */
function touchActivity() {
  lastActivityTimestamp = Date.now();
}

/**
 * Sucht Credentials für eine bestimmte Domain im entschlüsselten Cache.
 *
 * @param {string} domain – Basis-Domain (z. B. "github.com")
 * @returns {Array<{domain: string, username: string, password: string}>}
 */
function findCredentialsForDomain(domain) {
  if (!decryptedCredentials || !domain) return [];

  const baseDomain = getBaseDomain(domain).toLowerCase();
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');

  return decryptedCredentials.filter((cred) => {
    let credDomain = cred.domain || cred.url || cred.link || '';
    if (credDomain.startsWith('http://') || credDomain.startsWith('https://')) {
      try {
        credDomain = new URL(credDomain).hostname;
      } catch (e) {}
    }
    credDomain = credDomain.toLowerCase().replace(/^www\./, '');
    if (!credDomain) return false;

    const credBase = getBaseDomain(credDomain).toLowerCase();
    
    return credDomain === baseDomain ||
           credDomain === cleanDomain ||
           credDomain.endsWith('.' + baseDomain) ||
           cleanDomain.endsWith('.' + credDomain) ||
           credBase === baseDomain;
  });
}

/**
 * Prüft ob ein Credential im Cache existiert und ob es aktualisiert werden sollte.
 *
 * @param {string} domain
 * @param {string} username
 * @param {string} password
 * @returns {{shouldSave: boolean, isUpdate: boolean}}
 */
function checkCredentialInCache(domain, username, password) {
  if (!decryptedCredentials) return { shouldSave: false };

  const existing = findCredentialsForDomain(domain);
  const matchByUsername = existing.find(
    (c) => (c.username || c.user || '') === username
  );

  if (!matchByUsername) {
    // Neues Credential
    return { shouldSave: true, isUpdate: false };
  }

  if ((matchByUsername.password || matchByUsername.pass || '') !== password) {
    // Passwort hat sich geändert
    return { shouldSave: true, isUpdate: true };
  }

  // Credential existiert bereits mit gleichem Passwort
  return { shouldSave: false };
}

// ─────────────────────────────────────────────
// 6. Message-Handler
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Alle Handler sind async → true zurückgeben, damit der Kanal offen bleibt
  handleMessage(message, sendResponse);
  return true;
});

/**
 * Zentraler async Message-Dispatcher.
 * Leitet eingehende Nachrichten an den passenden Handler weiter.
 */
async function handleMessage(message, sendResponse) {
  try {
    // Aktivitäts-Zeitstempel bei jeder Nachricht aktualisieren
    touchActivity();

    switch (message.action) {
      // --- Content-Script Handler ---
      case 'get-logins-for-domain':
        await handleGetLogins(message, sendResponse);
        break;

      case 'check-if-credential-exists':
        await handleCheckCredential(message, sendResponse);
        break;

      case 'save-credential':
        await handleSaveCredential(message, sendResponse);
        break;

      case 'ignore-site':
        await handleIgnoreSite(message, sendResponse);
        break;

      case 'check-ignored':
        await handleCheckIgnored(message, sendResponse);
        break;

      case 'set-pending-save':
        await handleSetPendingSave(message, sendResponse);
        break;

      case 'get-pending-save':
        await handleGetPendingSave(message, sendResponse);
        break;

      // --- Popup Handler ---
      case 'get-vault-status':
        await handleGetVaultStatus(sendResponse);
        break;

      case 'setup-pin':
        await handleSetupPin(message, sendResponse);
        break;

      case 'unlock-vault':
        await handleUnlockVault(message, sendResponse);
        break;

      case 'lock-vault':
        handleLockVault(sendResponse);
        break;

      case 'pull-vault-from-app':
        await handlePullVaultFromApp(sendResponse);
        break;

      case 'set-lock-policy':
        await handleSetLockPolicy(message, sendResponse);
        break;

      case 'reset-vault':
        await handleResetVault(sendResponse);
        break;

      // --- Sync Handler (von Desktop-App via Native Messaging) ---
      case 'sync-vault':
        await handleSyncVault(message, sendResponse);
        break;

      default:
        sendResponse({ success: false, error: `Unbekannter Nachrichtentyp: ${message.action}` });
    }
  } catch (err) {
    console.error(`[PassSafer] Fehler bei "${message.action}":`, err);
    sendResponse({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────
// 6a) Native Request Helper
// ─────────────────────────────────────────────

/**
 * Sends a request to the running PassSafer desktop app via Chrome Native Messaging.
 *
 * @param {object} request - The request object (action, domain, username, password, etc.)
 * @returns {Promise<object>} The response from the app
 */
async function sendRequestToApp(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage('de.passsafer.helper', request, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[PassSafer] Native message failed:', chrome.runtime.lastError.message);
        appConnected = false;
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      appConnected = true;
      resolve(response);
    });
  });
}

/**
 * Prüft ob die Desktop-App erreichbar ist (nicht-blockierend).
 * @returns {Promise<boolean>}
 */
async function checkAppConnection() {
  try {
    await sendRequestToApp({ action: 'ping' });
    appConnected = true;
    return true;
  } catch {
    appConnected = false;
    return false;
  }
}

// ─────────────────────────────────────────────
// 6b) Logins für eine Domain abrufen
// ─────────────────────────────────────────────

/**
 * Holt Zugangsdaten – zuerst aus dem lokalen Cache, dann von der Desktop-App.
 */
async function handleGetLogins(message, sendResponse) {
  const { domain } = message;

  // Zuerst lokalen Cache prüfen (wenn entsperrt)
  if (isUnlocked()) {
    const credentials = findCredentialsForDomain(domain);
    if (credentials.length > 0) {
      sendResponse({ success: true, credentials });
      return;
    }
  }

  // Fallback: Desktop-App anfragen
  try {
    const response = await sendRequestToApp({
      action: 'get-credentials',
      domain,
    });
    sendResponse(response);
  } catch (err) {
    // Wenn auch der Cache leer war
    if (isUnlocked()) {
      sendResponse({ success: true, credentials: [] });
    } else {
      sendResponse({ success: false, error: 'VaultLocked', credentials: [] });
    }
  }
}

// ─────────────────────────────────────────────
// 6c) Prüfen ob Credential bereits existiert
// ─────────────────────────────────────────────

/**
 * Prüft ob das Credential bereits vorhanden ist – zuerst im Cache, dann in der Desktop-App.
 */
async function handleCheckCredential(message, sendResponse) {
  const { domain, username, password } = message;

  // Zuerst lokalen Cache prüfen (wenn entsperrt)
  if (isUnlocked()) {
    const result = checkCredentialInCache(domain, username, password);
    sendResponse(result);
    return;
  }

  // Fallback: Desktop-App anfragen
  try {
    const response = await sendRequestToApp({
      action: 'check-exists',
      domain,
      username,
      password,
    });
    sendResponse(response);
  } catch (err) {
    sendResponse({ shouldSave: false, error: 'AppOffline' });
  }
}

// ─────────────────────────────────────────────
// 6d) Credential speichern oder aktualisieren
// ─────────────────────────────────────────────

/**
 * Speichert oder aktualisiert ein Credential – im Cache UND an die Desktop-App weiterleiten.
 */
async function handleSaveCredential(message, sendResponse) {
  const { domain, username, password, isUpdate } = message;

  // Im lokalen Cache speichern (wenn entsperrt)
  if (isUnlocked()) {
    if (isUpdate) {
      // Existierendes Credential aktualisieren
      const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
      const existing = decryptedCredentials.find((c) => {
        let credDomain = c.domain || c.url || c.link || '';
        if (credDomain.startsWith('http://') || credDomain.startsWith('https://')) {
          try {
            credDomain = new URL(credDomain).hostname;
          } catch (e) {}
        }
        credDomain = credDomain.toLowerCase().replace(/^www\./, '');
        return credDomain === cleanDomain && ((c.username || c.user || '') === username);
      });
      if (existing) {
        existing.password = password;
        if (existing.pass !== undefined) existing.pass = password;
      }
    } else {
      // Neues Credential hinzufügen
      const cleanDomainForSave = domain.toLowerCase().replace(/^www\./, '');
      decryptedCredentials.push({
        domain: cleanDomainForSave,
        app: domain.charAt(0).toUpperCase() + domain.slice(1),
        link: domain.startsWith('http') ? domain : 'https://' + domain,
        username: username,
        password: password,
        notes: 'Saved automatically by PassSafer Browser Extension.',
        folderId: null,
        files: []
      });
    }

    // Verschlüsselten Cache aktualisieren
    try {
      const encryptedVault = await encryptVault(decryptedCredentials, masterPassword);
      await chrome.storage.local.set({
        encrypted_vault: encryptedVault,
        last_sync: Date.now(),
      });
    } catch (err) {
      console.warn('[PassSafer] Fehler beim Aktualisieren des Cache:', err);
    }
  }

  // An Desktop-App weiterleiten (wenn erreichbar)
  try {
    const response = await sendRequestToApp({
      action: 'save-credential',
      domain,
      username,
      password,
      isUpdate,
    });
    sendResponse(response);
  } catch (err) {
    // Wenn der Cache aktualisiert wurde, trotzdem Erfolg melden
    if (isUnlocked()) {
      sendResponse({ success: true, cachedOnly: true });
    } else {
      sendResponse({ success: false, error: 'AppOffline' });
    }
  }
}

// ─────────────────────────────────────────────
// 6e) Seite ignorieren
// ─────────────────────────────────────────────

/**
 * Fügt eine Domain zur Liste der ignorierten Seiten hinzu,
 * sodass dort kein Autofill/Save-Prompt angezeigt wird.
 */
async function handleIgnoreSite(message, sendResponse) {
  const { domain } = message;
  const data = await chrome.storage.local.get('ignored_domains');
  const ignoredDomains = data.ignored_domains || [];

  // Duplikate vermeiden
  if (!ignoredDomains.includes(domain)) {
    ignoredDomains.push(domain);
    await chrome.storage.local.set({ ignored_domains: ignoredDomains });
    console.log(`[PassSafer] Domain "${domain}" wird jetzt ignoriert.`);
  }

  sendResponse({ success: true });
}

// ─────────────────────────────────────────────
// 6f) Prüfen ob Seite ignoriert wird
// ─────────────────────────────────────────────

/**
 * Prüft, ob die angegebene Domain in der Ignorier-Liste steht.
 */
async function handleCheckIgnored(message, sendResponse) {
  const { domain } = message;
  const data = await chrome.storage.local.get('ignored_domains');
  const ignoredDomains = data.ignored_domains || [];

  sendResponse({ ignored: ignoredDomains.includes(domain) });
}

// ─────────────────────────────────────────────
// 6g) Pending-Save setzen
// ─────────────────────────────────────────────

/**
 * Speichert einen ausstehenden Speicher-Vorschlag,
 * z. B. wenn ein Formular abgeschickt wurde und der Nutzer
 * noch bestätigen soll, ob die Daten gespeichert werden.
 */
async function handleSetPendingSave(message, sendResponse) {
  const { data } = message;
  await chrome.storage.local.set({ pending_save: data });
  sendResponse({ success: true });
}

// ─────────────────────────────────────────────
// 6h) Pending-Save abrufen und löschen
// ─────────────────────────────────────────────

/**
 * Liest den ausstehenden Speicher-Vorschlag aus und löscht ihn
 * anschließend, damit er nur einmal verarbeitet wird.
 */
async function handleGetPendingSave(_message, sendResponse) {
  const data = await chrome.storage.local.get('pending_save');
  const pending = data.pending_save || null;

  // Pending-Save nach dem Abrufen zurücksetzen
  await chrome.storage.local.set({ pending_save: null });

  sendResponse({ pending });
}

// ─────────────────────────────────────────────
// 7. Popup-Handler: Vault-Status
// ─────────────────────────────────────────────

/**
 * Liefert den aktuellen Zustand des Tresors für die Popup-Anzeige.
 */
async function handleGetVaultStatus(sendResponse) {
  const data = await chrome.storage.local.get([
    'encrypted_vault',
    'pin_encrypted_master_key',
    'last_sync',
  ]);

  const hasVault = !!data.encrypted_vault;
  const hasPinSetup = !!data.pin_encrypted_master_key;

  // App-Verbindung prüfen (im Hintergrund)
  checkAppConnection().catch(() => {});

  sendResponse({
    hasVault,
    hasPinSetup,
    isUnlocked: isUnlocked(),
    credentialCount: decryptedCredentials ? decryptedCredentials.length : 0,
    lastSync: data.last_sync || null,
    appConnected,
  });
}

// ─────────────────────────────────────────────
// 8. Popup-Handler: PIN einrichten
// ─────────────────────────────────────────────

/**
 * Richtet die PIN ein und verschlüsselt das Master-Passwort damit.
 * Voraussetzung: Master-Passwort muss im Speicher sein (nach Pull von der App).
 */
async function handleSetupPin(message, sendResponse) {
  const { pin, lockPolicy } = message;

  if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    sendResponse({ success: false, error: 'PIN must be exactly 6 digits.' });
    return;
  }

  if (!masterPassword) {
    sendResponse({ success: false, error: 'No master password available. Please connect to the desktop app first.' });
    return;
  }

  try {
    const pinData = await encryptMasterKeyWithPin(pin, masterPassword);

    await chrome.storage.local.set({
      pin_encrypted_master_key: pinData.pin_encrypted_master_key,
      pin_salt: pinData.pin_salt,
      pin_iv: pinData.pin_iv,
      pin_lock_policy: lockPolicy || 'browser_restart',
    });

    console.log('[PassSafer] PIN set up successfully.');
    sendResponse({ success: true });
  } catch (err) {
    console.error('[PassSafer] Error during PIN setup:', err);
    sendResponse({ success: false, error: 'PIN setup failed.' });
  }
}

// ─────────────────────────────────────────────
// 9. Popup-Handler: Tresor entsperren
// ─────────────────────────────────────────────

/**
 * Entsperrt den Tresor mit der PIN:
 * 1. PIN-Key ableiten → Master-Passwort entschlüsseln
 * 2. Vault mit Master-Passwort entschlüsseln
 */
async function handleUnlockVault(message, sendResponse) {
  const { pin } = message;

  if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    sendResponse({ success: false, error: 'PIN must be exactly 6 digits.' });
    return;
  }

  // PIN brute-force protection
  const pinData = await chrome.storage.local.get(['pin_fail_count', 'pin_lockout_until']);
  const failCount = pinData.pin_fail_count || 0;
  const lockoutUntil = pinData.pin_lockout_until || 0;

  if (Date.now() < lockoutUntil) {
    const remainingSec = Math.ceil((lockoutUntil - Date.now()) / 1000);
    sendResponse({ success: false, error: `Too many failed attempts. Please wait ${remainingSec} seconds.` });
    return;
  }

  try {
    const data = await chrome.storage.local.get([
      'pin_encrypted_master_key',
      'pin_salt',
      'pin_iv',
      'encrypted_vault',
    ]);

    if (!data.pin_encrypted_master_key || !data.pin_salt || !data.pin_iv) {
      sendResponse({ success: false, error: 'No PIN set up.' });
      return;
    }

    if (!data.encrypted_vault) {
      sendResponse({ success: false, error: 'No vault found.' });
      return;
    }

    // Master-Passwort mit PIN entschlüsseln
    let decryptedMasterPassword;
    try {
      decryptedMasterPassword = await decryptMasterKeyWithPin(
        pin,
        data.pin_encrypted_master_key,
        data.pin_salt,
        data.pin_iv
      );
    } catch {
      // Increment fail counter and set lockout if needed
      const newFailCount = failCount + 1;
      const lockoutDuration = newFailCount >= 10 ? 300_000 : newFailCount >= 5 ? 30_000 : 0;
      await chrome.storage.local.set({
        pin_fail_count: newFailCount,
        pin_lockout_until: lockoutDuration ? Date.now() + lockoutDuration : 0
      });
      sendResponse({
        success: false,
        error: newFailCount >= 5
          ? `Incorrect PIN. Locked for ${lockoutDuration / 1000} seconds. (${newFailCount} failed attempts)`
          : 'Incorrect PIN.'
      });
      return;
    }

    // Vault mit Master-Passwort entschlüsseln
    try {
      decryptedCredentials = await decryptVault(data.encrypted_vault, decryptedMasterPassword);
    } catch (err) {
      console.error('[PassSafer] Vault decryption failed:', err);
      sendResponse({ success: false, error: 'Vault could not be decrypted.' });
      return;
    }

    // Reset PIN fail counter on success
    await chrome.storage.local.set({ pin_fail_count: 0, pin_lockout_until: 0 });

    masterPassword = decryptedMasterPassword;
    touchActivity();

    console.log(`[PassSafer] Vault unlocked – ${decryptedCredentials.length} entries loaded.`);
    sendResponse({ success: true });

  } catch (err) {
    console.error('[PassSafer] Error during unlock:', err);
    sendResponse({ success: false, error: 'Unlock failed.' });
  }
}

// ─────────────────────────────────────────────
// 10. Popup-Handler: Tresor sperren
// ─────────────────────────────────────────────

/**
 * Sperrt den Tresor und löscht das Master-Passwort aus dem Speicher.
 */
function handleLockVault(sendResponse) {
  lockVault();
  sendResponse({ success: true });
}

// ─────────────────────────────────────────────
// 11. Popup-Handler: Vault von Desktop-App ziehen
// ─────────────────────────────────────────────

/**
 * Zieht den kompletten Vault von der Desktop-App und speichert ihn verschlüsselt im Cache.
 * Erwartet von der App: { success: true, vault: "<base64>", masterPassword: "<string>" }
 */
async function handlePullVaultFromApp(sendResponse) {
  try {
    const response = await sendRequestToApp({ action: 'request-vault' });

    if (!response || !response.success) {
      sendResponse({ success: false, error: response?.error || 'Desktop app rejected the request.' });
      return;
    }

    if (!response.vault || !response.masterPassword) {
      sendResponse({ success: false, error: 'Incomplete response from desktop app.' });
      return;
    }

    // Master-Passwort und entschlüsselte Credentials im Speicher halten
    masterPassword = response.masterPassword;
    decryptedCredentials = response.vault.passwords || [];

    // Vault lokal verschlüsseln und speichern
    let encryptedVault;
    try {
      encryptedVault = await encryptVault(decryptedCredentials, masterPassword);
    } catch (err) {
      console.error('[PassSafer] Vault encryption for cache failed:', err);
      sendResponse({ success: false, error: 'Vault encryption failed.' });
      return;
    }

    // Verschlüsselten Vault im lokalen Cache speichern
    await chrome.storage.local.set({
      encrypted_vault: encryptedVault,
      last_sync: Date.now(),
    });

    touchActivity();
    console.log(`[PassSafer] Vault synchronized from desktop app – ${decryptedCredentials.length} entries.`);
    sendResponse({ success: true });

  } catch (err) {
    console.error('[PassSafer] Error in pull-vault-from-app:', err);
    sendResponse({ success: false, error: 'Desktop app not reachable.' });
  }
}

// ─────────────────────────────────────────────
// 12. Popup-Handler: Sperr-Verhalten ändern
// ─────────────────────────────────────────────

/**
 * Speichert das gewählte Sperr-Verhalten.
 */
async function handleSetLockPolicy(message, sendResponse) {
  const { policy } = message;
  const validPolicies = ['browser_restart', 'timeout_15m', 'timeout_1h', 'persistent'];

  if (!validPolicies.includes(policy)) {
    sendResponse({ success: false, error: 'Invalid locking behavior.' });
    return;
  }

  await chrome.storage.local.set({ pin_lock_policy: policy });
  touchActivity();
  console.log(`[PassSafer] Locking behavior changed to: ${policy}`);
  sendResponse({ success: true });
}

// ─────────────────────────────────────────────
// 13. Popup-Handler: PIN & Cache zurücksetzen
// ─────────────────────────────────────────────

/**
 * Löscht alle PIN- und Vault-Daten aus dem Storage und Speicher.
 */
async function handleResetVault(sendResponse) {
  lockVault();

  await chrome.storage.local.remove([
    'encrypted_vault',
    'pin_encrypted_master_key',
    'pin_salt',
    'pin_iv',
    'last_sync',
  ]);

  console.log('[PassSafer] PIN and cache reset.');
  sendResponse({ success: true });
}

// ─────────────────────────────────────────────
// 14. Sync-Handler: Vault-Push von Desktop-App
// ─────────────────────────────────────────────

/**
 * Empfängt einen Vault-Push von der Desktop-App (über Native Messaging).
 * Wird aufgerufen, wenn die App Änderungen hat.
 */
async function handleSyncVault(message, sendResponse) {
  const { vault, masterPassword: mp } = message;

  if (!vault) {
    sendResponse({ success: false, error: 'No vault in message.' });
    return;
  }

  // Verschlüsselten Vault im Cache speichern
  await chrome.storage.local.set({
    encrypted_vault: vault,
    last_sync: Date.now(),
  });

  // Wenn ein Master-Passwort mitgeliefert wurde, auch das aktualisieren
  if (mp) {
    masterPassword = mp;
  }

  // Wenn der Tresor entsperrt ist, den Cache neu entschlüsseln
  if (masterPassword) {
    try {
      decryptedCredentials = await decryptVault(vault, masterPassword);
      console.log(`[PassSafer] Vault sync: ${decryptedCredentials.length} entries updated.`);
    } catch (err) {
      console.warn('[PassSafer] Vault sync: decryption failed.', err);
    }
  }

  sendResponse({ success: true });
}
