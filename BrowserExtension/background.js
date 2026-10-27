importScripts('crypto-utils.js');

let masterPassword = null;
let decryptedCredentials = null;
let lastActivityTimestamp = Date.now();
let appConnected = false;

const DOUBLE_TLDS = [
  'co.uk', 'com.au', 'co.jp', 'co.kr', 'com.br',
  'co.in', 'org.uk', 'net.au', 'co.nz', 'co.za',
  'com.mx', 'com.sg', 'com.hk', 'com.tw', 'co.at', 'or.at'
];

const POPUP_ONLY_ACTIONS = new Set([
  'get-vault-status',
  'setup-pin',
  'unlock-vault',
  'lock-vault',
  'pull-vault-from-app',
  'set-lock-policy',
  'reset-vault',
  'sync-vault',
]);

function generateRandomVaultKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function extractHostname(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const urlStr = trimmed.includes('://') ? trimmed : 'https://' + trimmed;
    const parsed = new URL(urlStr);
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch (_) {
    return trimmed
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .split(':')[0]
      .replace(/^www\./, '')
      .replace(/\.$/, '');
  }
}

function getBaseDomain(hostname) {
  const clean = extractHostname(hostname);
  if (!clean) return '';
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const lastTwo = parts.slice(-2).join('.');
  if (DOUBLE_TLDS.includes(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function resolveAuthoritativeDomain(messageDomain, sender) {
  if (sender && sender.tab && sender.tab.url) {
    try {
      const tabUrl = new URL(sender.tab.url);
      if (tabUrl.protocol === 'file:') {
        return 'localhost';
      }
      if (tabUrl.protocol === 'https:' || tabUrl.protocol === 'http:') {
        const tabHost = extractHostname(tabUrl.hostname);
        if (tabHost) return tabHost;
      }
    } catch (_) {}
  }
  return extractHostname(messageDomain) || messageDomain || '';
}

async function persistSessionState() {
  if (!chrome.storage || !chrome.storage.session) return;
  try {
    if (masterPassword && decryptedCredentials) {
      await chrome.storage.session.set({
        session_master_password: masterPassword,
        session_decrypted_credentials: decryptedCredentials,
        last_activity_timestamp: lastActivityTimestamp,
      });
    } else {
      await chrome.storage.session.remove([
        'session_master_password',
        'session_decrypted_credentials',
        'last_activity_timestamp',
      ]);
    }
  } catch (_) {}
}

async function ensureSessionRestored() {
  if (masterPassword !== null && decryptedCredentials !== null) return;
  if (!chrome.storage || !chrome.storage.session) return;

  try {
    const sessionData = await chrome.storage.session.get([
      'session_master_password',
      'session_decrypted_credentials',
      'last_activity_timestamp',
    ]);
    if (!sessionData.session_master_password) return;

    const localData = await chrome.storage.local.get(['pin_lock_policy', 'encrypted_vault']);
    const policy = localData.pin_lock_policy || 'browser_restart';
    const lastActive = sessionData.last_activity_timestamp || Date.now();

    let timeoutMs = null;
    if (policy === 'timeout_15m') timeoutMs = 15 * 60 * 1000;
    if (policy === 'timeout_1h') timeoutMs = 60 * 60 * 1000;

    if (timeoutMs && (Date.now() - lastActive) > timeoutMs) {
      await lockVault();
      return;
    }

    masterPassword = sessionData.session_master_password;
    lastActivityTimestamp = lastActive;

    if (Array.isArray(sessionData.session_decrypted_credentials)) {
      decryptedCredentials = sessionData.session_decrypted_credentials;
    } else if (localData.encrypted_vault) {
      decryptedCredentials = await decryptVault(localData.encrypted_vault, masterPassword);
      await persistSessionState();
    }
  } catch (_) {
    masterPassword = null;
    decryptedCredentials = null;
  }
}

async function lockVault() {
  masterPassword = null;
  decryptedCredentials = null;
  if (chrome.storage && chrome.storage.session) {
    try {
      await chrome.storage.session.remove([
        'session_master_password',
        'session_decrypted_credentials',
        'last_activity_timestamp',
      ]);
    } catch (_) {}
  }
}

function isUnlocked() {
  return masterPassword !== null && decryptedCredentials !== null;
}

function touchActivity() {
  lastActivityTimestamp = Date.now();
  if (chrome.storage && chrome.storage.session && isUnlocked()) {
    chrome.storage.session.set({ last_activity_timestamp: lastActivityTimestamp }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  try {
    await chrome.storage.local.set({
      ignored_domains: [],
      pending_save: null,
      pin_lock_policy: 'browser_restart',
    });
  } catch (err) {
    console.error('[PassSafer] Storage initialization error:', err);
  }
});

chrome.alarms.get('lock-check', (existingAlarm) => {
  if (!existingAlarm) {
    chrome.alarms.create('lock-check', { periodInMinutes: 1 });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'lock-check') return;
  await ensureSessionRestored();
  if (!masterPassword) return;

  const data = await chrome.storage.local.get('pin_lock_policy');
  const policy = data.pin_lock_policy || 'browser_restart';

  let timeoutMs = null;
  if (policy === 'timeout_15m') timeoutMs = 15 * 60 * 1000;
  if (policy === 'timeout_1h') timeoutMs = 60 * 60 * 1000;

  if (timeoutMs && (Date.now() - lastActivityTimestamp) > timeoutMs) {
    await lockVault();
  }
});

function findCredentialsForDomain(domain) {
  if (!decryptedCredentials || !domain) return [];

  const cleanDomain = extractHostname(domain);
  const baseDomain = getBaseDomain(cleanDomain);
  if (!cleanDomain) return [];

  const baseLabel = baseDomain.split('.')[0] || '';
  const scoredMatches = [];

  for (const cred of decryptedCredentials) {
    if (!cred || cred.deletedAt) continue;
    const rawTarget = cred.domain || cred.url || cred.link || '';
    const credHost = extractHostname(rawTarget);
    const credBase = getBaseDomain(credHost);

    let score = 0;
    if (credHost) {
      if (credHost === cleanDomain) {
        score = 100;
      } else if (credHost === baseDomain || cleanDomain === credBase) {
        score = 90;
      } else if (credHost.endsWith('.' + baseDomain) || cleanDomain.endsWith('.' + credHost)) {
        score = 80;
      } else if (credBase && credBase === baseDomain) {
        score = 75;
      }
    } else if (cred.app && baseLabel.length >= 3) {
      const appNorm = String(cred.app).toLowerCase().trim();
      if (appNorm === baseLabel || appNorm === cleanDomain || appNorm === baseDomain) {
        score = 60;
      }
    }

    if (score > 0) {
      scoredMatches.push({ cred, score });
    }
  }

  scoredMatches.sort((a, b) => b.score - a.score);
  return scoredMatches.map((m) => m.cred);
}

function checkCredentialInCache(domain, username, password) {
  if (!decryptedCredentials) return { shouldSave: false };

  const existing = findCredentialsForDomain(domain);
  const normUser = (username || '').trim().toLowerCase();
  const matchByUsername = existing.find(
    (c) => (c.username || c.user || '').trim().toLowerCase() === normUser
  );

  if (!matchByUsername) {
    return { shouldSave: true, isUpdate: false };
  }

  if ((matchByUsername.password || matchByUsername.pass || '') !== password) {
    return { shouldSave: true, isUpdate: true };
  }

  return { shouldSave: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  try {
    if (!message || typeof message.action !== 'string') {
      sendResponse({ success: false, error: 'Invalid message' });
      return;
    }

    if (sender && sender.id && chrome.runtime && chrome.runtime.id && sender.id !== chrome.runtime.id) {
      sendResponse({ success: false, error: 'Unauthorized extension sender' });
      return;
    }

    if (POPUP_ONLY_ACTIONS.has(message.action) && sender && sender.tab) {
      sendResponse({ success: false, error: 'Action restricted to extension popup' });
      return;
    }

    await ensureSessionRestored();
    touchActivity();

    switch (message.action) {
      case 'get-logins-for-domain':
        await handleGetLogins(message, sender, sendResponse);
        break;

      case 'check-if-credential-exists':
        await handleCheckCredential(message, sender, sendResponse);
        break;

      case 'save-credential':
        await handleSaveCredential(message, sender, sendResponse);
        break;

      case 'ignore-site':
        await handleIgnoreSite(message, sender, sendResponse);
        break;

      case 'check-ignored':
        await handleCheckIgnored(message, sender, sendResponse);
        break;

      case 'set-pending-save':
        await handleSetPendingSave(message, sender, sendResponse);
        break;

      case 'get-pending-save':
        await handleGetPendingSave(message, sender, sendResponse);
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
        await handleLockVault(sendResponse);
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
        sendResponse({ success: false, error: `Unknown message action: ${message.action}` });
    }
  } catch (err) {
    console.error(`[PassSafer] Error handling "${message?.action}":`, err);
    sendResponse({ success: false, error: err.message });
  }
}

async function sendRequestToApp(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage('de.passsafer.helper', request, (response) => {
      if (chrome.runtime.lastError) {
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

async function handleGetLogins(message, sender, sendResponse) {
  const domain = resolveAuthoritativeDomain(message.domain, sender);

  if (isUnlocked()) {
    const credentials = findCredentialsForDomain(domain);
    sendResponse({ success: true, credentials });
    return;
  }

  try {
    const response = await sendRequestToApp({
      action: 'get-credentials',
      domain,
    });
    sendResponse(response);
  } catch (err) {
    sendResponse({ success: false, error: 'VaultLocked', credentials: [] });
  }
}

async function handleCheckCredential(message, sender, sendResponse) {
  const domain = resolveAuthoritativeDomain(message.domain, sender);
  const { username, password } = message;

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

async function handleSaveCredential(message, sender, sendResponse) {
  const domain = resolveAuthoritativeDomain(message.domain, sender);
  const { username, password, isUpdate } = message;
  const cleanDomain = extractHostname(domain);
  const now = Date.now();

  if (isUnlocked()) {
    const normUser = (username || '').trim().toLowerCase();
    if (isUpdate) {
      const existing = decryptedCredentials.find((c) => {
        const credDomain = extractHostname(c.domain || c.url || c.link || '');
        const credBase = getBaseDomain(credDomain);
        const targetBase = getBaseDomain(cleanDomain);
        const domainMatches = credDomain === cleanDomain || (credBase && credBase === targetBase);
        return domainMatches && (c.username || c.user || '').trim().toLowerCase() === normUser;
      });
      if (existing) {
        existing.password = password;
        if (existing.pass !== undefined) existing.pass = password;
        existing.updatedAt = now;
      }
    } else {
      const appTitle = cleanDomain
        ? cleanDomain.charAt(0).toUpperCase() + cleanDomain.slice(1)
        : domain;
      decryptedCredentials.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(now),
        domain: cleanDomain,
        app: appTitle,
        link: cleanDomain.startsWith('http') ? cleanDomain : 'https://' + cleanDomain,
        username: username,
        password: password,
        notes: 'Saved automatically by PassSafer Browser Extension.',
        folderId: null,
        files: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    try {
      const encryptedVault = await encryptVault(decryptedCredentials, masterPassword);
      await chrome.storage.local.set({
        encrypted_vault: encryptedVault,
        last_sync: now,
      });
      await persistSessionState();
    } catch (err) {
      console.warn('[PassSafer] Cache update error:', err);
    }
  }

  try {
    const response = await sendRequestToApp({
      action: 'save-credential',
      domain: cleanDomain || domain,
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
        const filtered = queue.filter(
          (q) => !(extractHostname(q.domain) === cleanDomain && q.username === username)
        );
        filtered.push({
          domain: cleanDomain || domain,
          username,
          password,
          isUpdate: !!isUpdate,
          savedAt: now,
        });
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

async function handleIgnoreSite(message, sender, sendResponse) {
  const domain = resolveAuthoritativeDomain(message.domain, sender);
  const cleanDomain = extractHostname(domain) || domain;
  const data = await chrome.storage.local.get('ignored_domains');
  const ignoredDomains = data.ignored_domains || [];

  if (!ignoredDomains.includes(cleanDomain)) {
    ignoredDomains.push(cleanDomain);
    await chrome.storage.local.set({ ignored_domains: ignoredDomains });
  }

  sendResponse({ success: true });
}

async function handleCheckIgnored(message, sender, sendResponse) {
  const domain = resolveAuthoritativeDomain(message.domain, sender);
  const cleanDomain = extractHostname(domain) || domain;
  const baseDomain = getBaseDomain(cleanDomain);
  const data = await chrome.storage.local.get('ignored_domains');
  const ignoredDomains = data.ignored_domains || [];

  const isIgnored = ignoredDomains.some((d) => {
    const cleanIgnored = extractHostname(d) || d;
    return cleanIgnored === cleanDomain || cleanIgnored === baseDomain;
  });

  sendResponse({ ignored: isIgnored });
}

async function handleSetPendingSave(message, sender, sendResponse) {
  const { data } = message;
  if (data && typeof data === 'object') {
    const authDomain = resolveAuthoritativeDomain(data.domain, sender);
    data.domain = getBaseDomain(authDomain) || authDomain;
  }
  await chrome.storage.local.set({ pending_save: data || null });
  sendResponse({ success: true });
}

async function handleGetPendingSave(_message, sender, sendResponse) {
  const data = await chrome.storage.local.get('pending_save');
  const pending = data.pending_save || null;

  if (pending && sender && sender.tab && sender.tab.url) {
    const senderDomain = getBaseDomain(resolveAuthoritativeDomain('', sender));
    const pendingDomain = getBaseDomain(pending.domain);
    if (senderDomain && pendingDomain && senderDomain !== pendingDomain) {
      sendResponse({ pending: null });
      return;
    }
  }

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
    sendResponse({
      success: false,
      error: 'No vault key available. Please connect to the desktop app first.',
    });
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

    await persistSessionState();
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
    sendResponse({
      success: false,
      error: `Too many failed attempts. Please wait ${remainingSec} seconds.`,
    });
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
        pin_lockout_until: lockoutDuration ? Date.now() + lockoutDuration : 0,
      });
      sendResponse({
        success: false,
        error:
          newFailCount >= 5
            ? `Incorrect PIN. Locked for ${lockoutDuration / 1000} seconds. (${newFailCount} failed attempts)`
            : 'Incorrect PIN.',
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
    await persistSessionState();

    sendResponse({ success: true });
  } catch (err) {
    console.error('[PassSafer] Error during unlock:', err);
    sendResponse({ success: false, error: 'Unlock failed.' });
  }
}

async function handleLockVault(sendResponse) {
  await lockVault();
  sendResponse({ success: true });
}

async function handlePullVaultFromApp(sendResponse) {
  try {
    const queueData = await chrome.storage.local.get('pending_push_queue');
    const pendingQueue = queueData.pending_push_queue || [];
    const remainingQueue = [];

    for (const pending of pendingQueue) {
      try {
        await sendRequestToApp({
          action: 'save-credential',
          domain: pending.domain,
          username: pending.username,
          password: pending.password,
          isUpdate: !!pending.isUpdate,
        });
      } catch (_) {
        remainingQueue.push(pending);
      }
    }

    const response = await sendRequestToApp({ action: 'request-vault' });

    if (!response || !response.success) {
      sendResponse({
        success: false,
        error: response?.error || 'Desktop app rejected the request.',
      });
      return;
    }

    if (!response.vault) {
      sendResponse({ success: false, error: 'Incomplete response from desktop app.' });
      return;
    }

    if (!masterPassword) {
      masterPassword = generateRandomVaultKey();
    }

    const appCredentials = Array.isArray(response.vault)
      ? response.vault
      : response.vault && Array.isArray(response.vault.passwords)
        ? response.vault.passwords
        : [];

    let mergedCredentials = [...appCredentials];

    for (const pending of remainingQueue) {
      const pDomain = extractHostname(pending.domain);
      const existingIdx = mergedCredentials.findIndex((c) => {
        const cDomain = extractHostname(c.domain || c.url || c.link || '');
        return cDomain === pDomain && (c.username || c.user || '') === pending.username;
      });
      if (existingIdx >= 0) {
        mergedCredentials[existingIdx].password = pending.password;
        if (mergedCredentials[existingIdx].pass !== undefined) {
          mergedCredentials[existingIdx].pass = pending.password;
        }
      } else {
        mergedCredentials.push({
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          domain: pDomain,
          app: pDomain ? pDomain.charAt(0).toUpperCase() + pDomain.slice(1) : pending.domain,
          link: pDomain.startsWith('http') ? pDomain : 'https://' + pDomain,
          username: pending.username,
          password: pending.password,
          notes: 'Saved automatically by PassSafer Browser Extension.',
          folderId: null,
          files: [],
        });
      }
    }
    decryptedCredentials = mergedCredentials;

    if (remainingQueue.length > 0) {
      await chrome.storage.local.set({ pending_push_queue: remainingQueue });
    } else {
      await chrome.storage.local.remove('pending_push_queue');
    }

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
    await persistSessionState();
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
  sendResponse({ success: true });
}

async function handleResetVault(sendResponse) {
  await lockVault();

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

  sendResponse({ success: true });
}

async function handleSyncVault(message, sendResponse) {
  const { vault } = message;

  if (!vault) {
    sendResponse({ success: false, error: 'No vault in message.' });
    return;
  }

  const credentials = Array.isArray(vault) ? vault : vault.passwords || [];

  if (!masterPassword) {
    masterPassword = generateRandomVaultKey();
  }
  decryptedCredentials = credentials;

  if (masterPassword && decryptedCredentials) {
    try {
      const encryptedVault = await encryptVault(decryptedCredentials, masterPassword);
      await chrome.storage.local.set({
        encrypted_vault: encryptedVault,
        last_sync: Date.now(),
      });
      await persistSessionState();
    } catch (err) {
      console.warn('[PassSafer] Vault sync: local cache update failed.', err);
    }
  }

  sendResponse({ success: true });
}
