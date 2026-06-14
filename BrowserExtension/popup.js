/**
 * PassSafer – Popup Script
 *
 * Controls the popup interface of the browser extension:
 *   - PIN entry and setup
 *   - Status display (locked/unlocked)
 *   - Settings (locking behavior)
 *   - Synchronization with the desktop app
 */
'use strict';

// ─────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────

const views = {
  noVault: document.getElementById('view-no-vault'),
  setupPin: document.getElementById('view-setup-pin'),
  locked: document.getElementById('view-locked'),
  unlocked: document.getElementById('view-unlocked'),
};

const elements = {
  btnConnect: document.getElementById('btn-connect'),
  btnSavePin: document.getElementById('btn-save-pin'),
  btnUnlock: document.getElementById('btn-unlock'),
  btnLock: document.getElementById('btn-lock'),
  btnSync: document.getElementById('btn-sync'),
  btnReset: document.getElementById('btn-reset'),
  setupLockPolicy: document.getElementById('setup-lock-policy'),
  lockPolicySelect: document.getElementById('lock-policy-select'),
  vaultCount: document.getElementById('vault-count'),
  lastSync: document.getElementById('last-sync'),
  appStatus: document.getElementById('app-status'),
  msgNoVault: document.getElementById('msg-no-vault'),
  msgSetup: document.getElementById('msg-setup'),
  msgUnlock: document.getElementById('msg-unlock'),
  syncFooter: document.getElementById('sync-footer'),
};

// ─────────────────────────────────────────────
// PIN Input Groups Management
// ─────────────────────────────────────────────

/**
 * Initializes a group of PIN input fields with auto-focus logic.
 * @param {string} containerId – ID of the container
 * @param {Function} [onComplete] – Callback when all 6 digits are entered
 * @returns {{ getPin: () => string, clear: () => void, setError: () => void }}
 */
function initPinInputGroup(containerId, onComplete) {
  const container = document.getElementById(containerId);
  const inputs = Array.from(container.querySelectorAll('.pin-digit'));

  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      // Allow digits only
      input.value = input.value.replace(/\D/g, '').slice(0, 1);

      if (input.value && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }

      // Remove error class on input
      input.classList.remove('error');

      // Check if all fields are filled
      const pin = inputs.map(i => i.value).join('');
      if (pin.length === 6 && onComplete) {
        onComplete(pin);
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        inputs[index - 1].focus();
      }
    });

    // Paste handler: insert full PIN
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      for (let i = 0; i < inputs.length; i++) {
        inputs[i].value = pasted[i] || '';
      }
      if (pasted.length > 0) {
        const focusIndex = Math.min(pasted.length, inputs.length - 1);
        inputs[focusIndex].focus();
      }
      if (pasted.length === 6 && onComplete) {
        onComplete(pasted);
      }
    });
  });

  return {
    getPin() {
      return inputs.map(i => i.value).join('');
    },
    clear() {
      inputs.forEach(i => { i.value = ''; i.classList.remove('error'); });
      inputs[0].focus();
    },
    setError() {
      inputs.forEach(i => i.classList.add('error'));
    },
    focus() {
      inputs[0].focus();
    },
  };
}

// ─────────────────────────────────────────────
// Initialize PIN Groups
// ─────────────────────────────────────────────

const pinSetup = initPinInputGroup('pin-setup-inputs', () => updateSavePinButton());
const pinConfirm = initPinInputGroup('pin-confirm-inputs', () => updateSavePinButton());
const pinUnlock = initPinInputGroup('pin-unlock-inputs', (pin) => {
  elements.btnUnlock.disabled = false;
});

/** Enables the Save PIN button only when both PINs have 6 digits */
function updateSavePinButton() {
  const pin1 = pinSetup.getPin();
  const pin2 = pinConfirm.getPin();
  elements.btnSavePin.disabled = !(pin1.length === 6 && pin2.length === 6);
}

// ─────────────────────────────────────────────
// Communication with the Background Worker
// ─────────────────────────────────────────────

/**
 * Sends a message to the background worker.
 * @param {object} message
 * @returns {Promise<*>}
 */
function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

// ─────────────────────────────────────────────
// Show Messages
// ─────────────────────────────────────────────

/**
 * Displays a message in an element.
 * @param {HTMLElement} el
 * @param {string} text
 * @param {'error'|'success'|'info'} type
 */
function showMessage(el, text, type) {
  el.className = `message ${type}`;
  el.textContent = text;
}

/** Hides a message. */
function hideMessage(el) {
  el.className = 'message';
  el.textContent = '';
}

// ─────────────────────────────────────────────
// View Control
// ─────────────────────────────────────────────

/** Shows exactly one view and hides all others. */
function showView(viewName) {
  for (const [name, el] of Object.entries(views)) {
    el.classList.toggle('active', name === viewName);
  }
}

// ─────────────────────────────────────────────
// Load and Display Status
// ─────────────────────────────────────────────

/** Loads the current status and shows the appropriate view. */
async function loadStatus() {
  try {
    const status = await sendToBackground({ action: 'get-vault-status' });

    if (!status.hasVault && !status.hasPinSetup) {
      // No vault and no PIN configured
      showView('noVault');
      return;
    }

    if (status.hasVault && !status.hasPinSetup) {
      // Vault exists, but no PIN has been set up yet.
      // CRITICAL BUG FIX: If we are currently locked (no master password in memory), we cannot set up the PIN!
      // We must show the connect screen so the user can pull the vault (which populates the master password).
      if (!status.isUnlocked) {
        showView('noVault');
        showMessage(elements.msgNoVault, 'Please connect to the desktop app to retrieve the vault and set up your PIN.', 'info');
        return;
      }
      showView('setupPin');
      pinSetup.focus();
      return;
    }

    if (!status.isUnlocked) {
      // Vault exists + PIN configured, but locked
      showView('locked');
      pinUnlock.focus();
      return;
    }

    // Unlocked → display status details
    showView('unlocked');
    elements.vaultCount.textContent = status.credentialCount ?? '–';
    elements.lastSync.textContent = status.lastSync
      ? new Date(status.lastSync).toLocaleString()
      : 'Never';
    elements.appStatus.textContent = status.appConnected ? 'Connected' : 'Not Connected';

    // Load locking behavior
    const data = await chrome.storage.local.get('pin_lock_policy');
    const policy = data.pin_lock_policy || 'browser_restart';
    elements.lockPolicySelect.value = policy;

  } catch (err) {
    console.error('[PassSafer Popup] Error loading status:', err);
  }
}

// ─────────────────────────────────────────────
// Event Handlers
// ─────────────────────────────────────────────

// --- Connect to Desktop App ---
elements.btnConnect.addEventListener('click', async () => {
  hideMessage(elements.msgNoVault);
  elements.btnConnect.disabled = true;
  elements.btnConnect.textContent = 'Connecting...';

  try {
    const response = await sendToBackground({ action: 'pull-vault-from-app' });
    if (response.success) {
      showMessage(elements.msgNoVault, 'Vault synchronized successfully!', 'success');
      setTimeout(() => loadStatus(), 500);
    } else {
      showMessage(elements.msgNoVault, response.error || 'Connection failed.', 'error');
    }
  } catch (err) {
    showMessage(elements.msgNoVault, 'Desktop app not reachable.', 'error');
  } finally {
    elements.btnConnect.disabled = false;
    elements.btnConnect.textContent = 'Connect to Desktop App';
  }
});

// --- Save PIN ---
elements.btnSavePin.addEventListener('click', async () => {
  hideMessage(elements.msgSetup);
  const pin1 = pinSetup.getPin();
  const pin2 = pinConfirm.getPin();

  if (pin1.length !== 6) {
    showMessage(elements.msgSetup, 'Please enter a 6-digit PIN.', 'error');
    pinSetup.setError();
    return;
  }

  if (pin1 !== pin2) {
    showMessage(elements.msgSetup, 'PINs do not match.', 'error');
    pinConfirm.setError();
    pinConfirm.clear();
    return;
  }

  elements.btnSavePin.disabled = true;
  elements.btnSavePin.textContent = 'Saving...';

  try {
    const policy = elements.setupLockPolicy.value;
    const response = await sendToBackground({
      action: 'setup-pin',
      pin: pin1,
      lockPolicy: policy,
    });

    if (response.success) {
      showMessage(elements.msgSetup, 'PIN set up successfully!', 'success');
      setTimeout(() => loadStatus(), 500);
    } else {
      showMessage(elements.msgSetup, response.error || 'Could not save PIN.', 'error');
    }
  } catch (err) {
    showMessage(elements.msgSetup, 'Error saving PIN.', 'error');
  } finally {
    elements.btnSavePin.disabled = false;
    elements.btnSavePin.textContent = 'Save PIN';
  }
});

// --- Unlock Vault ---
elements.btnUnlock.addEventListener('click', async () => {
  hideMessage(elements.msgUnlock);
  const pin = pinUnlock.getPin();

  if (pin.length !== 6) {
    showMessage(elements.msgUnlock, 'Please enter a 6-digit PIN.', 'error');
    pinUnlock.setError();
    return;
  }

  elements.btnUnlock.disabled = true;
  elements.btnUnlock.textContent = 'Unlocking...';

  try {
    const response = await sendToBackground({
      action: 'unlock-vault',
      pin,
    });

    if (response.success) {
      await loadStatus();
    } else {
      showMessage(elements.msgUnlock, response.error || 'Incorrect PIN.', 'error');
      pinUnlock.setError();
      pinUnlock.clear();
    }
  } catch (err) {
    showMessage(elements.msgUnlock, 'Error unlocking.', 'error');
    pinUnlock.clear();
  } finally {
    elements.btnUnlock.disabled = false;
    elements.btnUnlock.textContent = 'Unlock';
  }
});

// --- Lock Vault ---
elements.btnLock.addEventListener('click', async () => {
  try {
    await sendToBackground({ action: 'lock-vault' });
    await loadStatus();
  } catch (err) {
    console.error('[PassSafer Popup] Error locking:', err);
  }
});

// --- Sync Now ---
elements.btnSync.addEventListener('click', async () => {
  elements.btnSync.disabled = true;
  elements.btnSync.textContent = 'Synchronizing...';

  try {
    const response = await sendToBackground({ action: 'pull-vault-from-app' });
    if (response.success) {
      elements.syncFooter.textContent = 'Synchronization successful.';
      await loadStatus();
    } else {
      elements.syncFooter.textContent = response.error || 'Synchronization failed.';
    }
  } catch (err) {
    elements.syncFooter.textContent = 'Desktop app not reachable.';
  } finally {
    elements.btnSync.disabled = false;
    elements.btnSync.textContent = 'Sync Now';
  }
});

// --- Change Locking Behavior ---
elements.lockPolicySelect.addEventListener('change', async () => {
  const policy = elements.lockPolicySelect.value;
  await sendToBackground({ action: 'set-lock-policy', policy });
});

// --- Reset PIN & Cache ---
elements.btnReset.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to reset the PIN and the local cache?\n\n' +
    'You will need to connect to the desktop app again afterwards.'
  );
  if (!confirmed) return;

  try {
    await sendToBackground({ action: 'reset-vault' });
    await loadStatus();
  } catch (err) {
    console.error('[PassSafer Popup] Error resetting:', err);
  }
});

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────

loadStatus();
