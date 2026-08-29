
importScripts('crypto-utils.js');

let masterPassword = null;

let decryptedCredentials = null;

let lastActivityTimestamp = Date.now();

let appConnected = false;

chrome.runtime.onInstalled.addListener(async (details) => {

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

chrome.alarms.get('lock-check', (existingAlarm) => {
  if (!existingAlarm) {
    chrome.alarms.create('lock-check', { periodInMinutes: 1 });
  }
});

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

function getBaseDomain(hostname) {

  const DOUBLE_TLDS = ['co.uk', 'com.au', 'co.jp', 'co.kr', 'com.br', 'co.in', 'org.uk', 'net.au', 'co.nz'];

  const parts = hostname.replace(/\.$/, '').split('.');

  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join('.');
    if (DOUBLE_TLDS.includes(lastTwo)) {

      return parts.slice(-3).join('.');
    }
  }

  return parts.slice(-2).join('.');
}

function lockVault() {
  masterPassword = null;
  decryptedCredentials = null;
  console.log('[PassSafer] Tresor gesperrt.');
}

function isUnlocked() {
  return masterPassword !== null && decryptedCredentials !== null;
}

function touchActivity() {
  lastActivityTimestamp = Date.now();
}

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

function checkCredentialInCache(domain, username, password) {
  if (!decryptedCredentials) return { shouldSave: false };

  const existing = findCredentialsForDomain(domain);
  const matchByUsername = existing.find(
    (c) => (c.username || c.user || '') === username
  );

  if (!matchByUsername) {

    return { shouldSave: true, isUpdate: false };
  }

  if ((matchByUsername.password || matchByUsername.pass || '') !== password) {

    return { shouldSave: true, isUpdate: true };
  }

  return { shouldSave: false };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  handleMessage(message, sendResponse);
  return true;
});

async function handleMessage(message, sendResponse) {
  try {

    touchActivity();

    switch (message.action) {

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

async function handleGetLogins(message, sendResponse) {
  const { domain } = message;

  if (isUnlocked()) {
    const credentials = findCredentialsForDomain(domain);
    if (credentials.length > 0) {
      sendResponse({ success: true, credentials });
      return;
    }
  }

  try {
    const response = await sendRequestToApp({
      action: 'get-credentials',
      domain,
    });
    sendResponse(response);
  } catch (err) {

    if (isUnlocked()) {
      sendResponse({ success: true, credentials: [] });
    } else {
      sendResponse({ success: false, error: 'VaultLocked', credentials: [] });
    }
  }
}

async function handleCheckCredential(message, sendResponse) {
  const { domain, username, password } = message;

  if (isUnlocked()) {
    const result = checkCredentialInCache(domain, username, password);
    sendResponse(result);
    return;
  }

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

async function handleSaveCredential(message, sendResponse) {
  const { domain, username, password, isUpdate } = message;

  if (isUnlocked()) {
    if (isUpdate) {

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

    if (isUnlocked()) {

      try {
        const queueData = await chrome.storage.local.get('pending_push_queue');
        const queue = queueData.pending_push_queue || [];

        const filtered = queue.filter(q => !(q.domain === domain && q.username === username));
        filtered.push({ domain, username, password, isUpdate: !!isUpdate, savedAt: Date.now() });
        await chrome.storage.local.set({ pending_push_queue: filtered });
      } catch (qErr) {
        console.warn('[PassSafer] Could not save to pending push queue:', qErr);
      }
      sendResponse({ success: true, cachedOnly: true });
    } else {
      sendResponse({ success: false, error: 'AppOffline' });
    }
  }
}

async function handleIgnoreSite(message, sendResponse) {
  const { domain } = message;
  const data = await chrome.storage.local.get('ignored_domains');
  const ignoredDomains = data.ignored_domains || [];

  if (!ignoredDomains.includes(domain)) {
    ignoredDomains.push(domain);
    await chrome.storage.local.set({ ignored_domains: ignoredDomains });
    console.log(`[PassSafer] Domain "${domain}" wird jetzt ignoriert.`);
  }

  sendResponse({ success: true });
}

async function handleCheckIgnored(message, sendResponse) {
  const { domain } = message;
  const data = await chrome.storage.local.get('ignored_domains');
  const ignoredDomains = data.ignored_domains || [];

  sendResponse({ ignored: ignoredDomains.includes(domain) });
}

async function handleSetPendingSave(message, sendResponse) {
  const { data } = message;
  await chrome.storage.local.set({ pending_save: data });
  sendResponse({ success: true });
}

async function handleGetPendingSave(_message, sendResponse) {
  const data = await chrome.storage.local.get('pending_save');
  const pending = data.pending_save || null;

  await chrome.storage.local.set({ pending_save: null });

  sendResponse({ pending });
}

async function handleGetVaultStatus(sendResponse) {
  const data = await chrome.storage.local.get([
    'encrypted_vault',
    'pin_encrypted_master_key',
    'last_sync',
  ]);

  const hasVault = !!data.encrypted_vault;
  const hasPinSetup = !!data.pin_encrypted_master_key;

  try {
    await checkAppConnection();
  } catch (_) {}

  sendResponse({
    hasVault,
    hasPinSetup,
    isUnlocked: isUnlocked(),
    credentialCount: decryptedCredentials ? decryptedCredentials.length : 0,
    lastSync: data.last_sync || null,
    appConnected,
  });
}

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

async function handleUnlockVault(message, sendResponse) {
  const { pin } = message;

  if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    sendResponse({ success: false, error: 'PIN must be exactly 6 digits.' });
    return;
  }

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

    let decryptedMasterPassword;
    try {
      decryptedMasterPassword = await decryptMasterKeyWithPin(
        pin,
        data.pin_encrypted_master_key,
        data.pin_salt,
        data.pin_iv
      );
    } catch {

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

    try {
      decryptedCredentials = await decryptVault(data.encrypted_vault, decryptedMasterPassword);
    } catch (err) {
      console.error('[PassSafer] Vault decryption failed:', err);
      sendResponse({ success: false, error: 'Vault could not be decrypted.' });
      return;
    }

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

function handleLockVault(sendResponse) {
  lockVault();
  sendResponse({ success: true });
}

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

    masterPassword = response.masterPassword;
    const appCredentials = Array.isArray(response.vault) ? response.vault : (response.vault && Array.isArray(response.vault.passwords) ? response.vault.passwords : []);

    const queueData = await chrome.storage.local.get('pending_push_queue');
    const pendingQueue = queueData.pending_push_queue || [];
    let mergedCredentials = [...appCredentials];

    for (const pending of pendingQueue) {
      const existingIdx = mergedCredentials.findIndex(c => {
        const cDomain = (c.domain || c.url || '').toLowerCase().replace(/^www\./, '').replace(/^https?:\/\//, '');
        const pDomain = pending.domain.toLowerCase().replace(/^www\./, '');
        return cDomain === pDomain && (c.username || c.user || '') === pending.username;
      });
      if (existingIdx >= 0) {
        mergedCredentials[existingIdx].password = pending.password;
        if (mergedCredentials[existingIdx].pass !== undefined) mergedCredentials[existingIdx].pass = pending.password;
      } else {
        mergedCredentials.push({
          domain: pending.domain.toLowerCase().replace(/^www\./, ''),
          app: pending.domain.charAt(0).toUpperCase() + pending.domain.slice(1),
          link: pending.domain.startsWith('http') ? pending.domain : 'https://' + pending.domain,
          username: pending.username,
          password: pending.password,
          notes: 'Saved automatically by PassSafer Browser Extension.',
          folderId: null,
          files: []
        });
      }
    }
    decryptedCredentials = mergedCredentials;

    await chrome.storage.local.remove('pending_push_queue');

    let encryptedVault;
    try {
      encryptedVault = await encryptVault(decryptedCredentials, masterPassword);
    } catch (err) {
      console.error('[PassSafer] Vault encryption for cache failed:', err);
      sendResponse({ success: false, error: 'Vault encryption failed.' });
      return;
    }

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

async function handleResetVault(sendResponse) {
  lockVault();

  await chrome.storage.local.remove([
    'encrypted_vault',
    'pin_encrypted_master_key',
    'pin_salt',
    'pin_iv',
    'last_sync',
    'pin_fail_count',
    'pin_lockout_until',
    'pending_push_queue',
  ]);

  console.log('[PassSafer] PIN and cache reset.');
  sendResponse({ success: true });
}

async function handleSyncVault(message, sendResponse) {
  const { vault, masterPassword: mp } = message;

  if (!vault) {
    sendResponse({ success: false, error: 'No vault in message.' });
    return;
  }

  const credentials = Array.isArray(vault) ? vault : (vault.passwords || []);

  if (masterPassword || mp) {
    if (mp) masterPassword = mp;
    decryptedCredentials = credentials;
    console.log(`[PassSafer] Vault sync: ${decryptedCredentials.length} entries updated.`);
  }

  if (masterPassword && decryptedCredentials) {
    try {
      const encryptedVault = await encryptVault(decryptedCredentials, masterPassword);
      await chrome.storage.local.set({
        encrypted_vault: encryptedVault,
        last_sync: Date.now(),
      });
    } catch (err) {
      console.warn('[PassSafer] Vault sync: local cache update failed.', err);
    }
  }

  sendResponse({ success: true });
}
