/**
 * PassSafer – Kryptografie-Modul (Service Worker)
 *
 * Stellt Funktionen für PIN-basierte Verschlüsselung bereit:
 *   - PIN-Key Ableitung via PBKDF2-SHA256 (100.000 Iterationen)
 *   - AES-256-GCM Verschlüsselung / Entschlüsselung
 *   - Vault-Entschlüsselung mit Master-Passwort
 *
 * Nutzt ausschließlich die Web Crypto API (SubtleCrypto).
 */

// ─────────────────────────────────────────────
// Konstanten
// ─────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_LENGTH = 256;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;

// ─────────────────────────────────────────────
// Hilfsfunktionen: Encoding
// ─────────────────────────────────────────────

/**
 * Konvertiert einen ArrayBuffer in einen Base64-String.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Konvertiert einen Base64-String in einen ArrayBuffer.
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─────────────────────────────────────────────
// PIN-Key Ableitung
// ─────────────────────────────────────────────

/**
 * Leitet einen AES-256-GCM-Schlüssel aus einer 6-stelligen PIN und einem Salt ab.
 * Verwendet PBKDF2 mit SHA-256 und 100.000 Iterationen.
 *
 * @param {string} pin – 6-stellige PIN
 * @param {ArrayBuffer} salt – Zufälliges Salt (32 Bytes)
 * @returns {Promise<CryptoKey>} – AES-GCM Schlüssel
 */
async function derivePinKey(pin, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─────────────────────────────────────────────
// AES-GCM Verschlüsselung / Entschlüsselung
// ─────────────────────────────────────────────

/**
 * Verschlüsselt Klartext mit AES-256-GCM.
 *
 * @param {CryptoKey} key – AES-GCM Schlüssel
 * @param {string} plaintext – Zu verschlüsselnder Text
 * @returns {Promise<{ciphertext: string, iv: string}>} – Base64-kodiertes Ergebnis
 */
async function encryptAesGcm(key, plaintext) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Entschlüsselt AES-256-GCM verschlüsselte Daten.
 *
 * @param {CryptoKey} key – AES-GCM Schlüssel
 * @param {string} ciphertextBase64 – Base64-kodierter Ciphertext
 * @param {string} ivBase64 – Base64-kodierter IV
 * @returns {Promise<string>} – Entschlüsselter Klartext
 */
async function decryptAesGcm(key, ciphertextBase64, ivBase64) {
  const ciphertext = base64ToArrayBuffer(ciphertextBase64);
  const iv = base64ToArrayBuffer(ivBase64);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintextBuffer);
}

// ─────────────────────────────────────────────
// PIN-Setup: Master-Passwort mit PIN verschlüsseln
// ─────────────────────────────────────────────

/**
 * Verschlüsselt das Master-Passwort mit einer PIN.
 * Erzeugt ein zufälliges Salt und leitet daraus den PIN-Key ab.
 *
 * @param {string} pin – 6-stellige PIN
 * @param {string} masterPassword – Das Master-Passwort im Klartext
 * @returns {Promise<{pin_encrypted_master_key: string, pin_salt: string, pin_iv: string}>}
 */
async function encryptMasterKeyWithPin(pin, masterPassword) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const pinKey = await derivePinKey(pin, salt.buffer);
  const { ciphertext, iv } = await encryptAesGcm(pinKey, masterPassword);

  return {
    pin_encrypted_master_key: ciphertext,
    pin_salt: arrayBufferToBase64(salt.buffer),
    pin_iv: iv,
  };
}

/**
 * Entschlüsselt das Master-Passwort mit einer PIN.
 *
 * @param {string} pin – 6-stellige PIN
 * @param {string} encryptedMasterKey – Base64-kodierter verschlüsselter Master-Key
 * @param {string} saltBase64 – Base64-kodiertes Salt
 * @param {string} ivBase64 – Base64-kodierter IV
 * @returns {Promise<string>} – Das entschlüsselte Master-Passwort
 * @throws {Error} – Bei falschem PIN (AES-GCM Authentifizierung schlägt fehl)
 */
async function decryptMasterKeyWithPin(pin, encryptedMasterKey, saltBase64, ivBase64) {
  const salt = base64ToArrayBuffer(saltBase64);
  const pinKey = await derivePinKey(pin, salt);
  return decryptAesGcm(pinKey, encryptedMasterKey, ivBase64);
}

// ─────────────────────────────────────────────
// Vault-Entschlüsselung mit Master-Passwort
// ─────────────────────────────────────────────

/**
 * Entschlüsselt den verschlüsselten Vault mit dem Master-Passwort.
 * Der Vault ist als Base64-kodierter Blob gespeichert: Salt (32B) + IV (12B) + Ciphertext.
 *
 * @param {string} encryptedVaultBase64 – Base64-kodierter verschlüsselter Vault
 * @param {string} masterPassword – Das Master-Passwort
 * @returns {Promise<Array>} – Die entschlüsselte Credential-Liste
 */
async function decryptVault(encryptedVaultBase64, masterPassword) {
  const vaultBuffer = base64ToArrayBuffer(encryptedVaultBase64);
  const vaultBytes = new Uint8Array(vaultBuffer);

  // Vault-Format: Salt (32 Bytes) | IV (12 Bytes) | Ciphertext
  const salt = vaultBytes.slice(0, SALT_LENGTH);
  const iv = vaultBytes.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = vaultBytes.slice(SALT_LENGTH + IV_LENGTH);

  const masterKey = await deriveMasterKey(masterPassword, salt);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    ciphertext
  );

  const jsonStr = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(jsonStr);
}

/**
 * Leitet den Vault-Schlüssel aus dem Master-Passwort ab.
 * Verwendet PBKDF2 mit SHA-256 und 100.000 Iterationen.
 *
 * @param {string} masterPassword – Das Master-Passwort
 * @param {Uint8Array} salt – Salt aus dem Vault-Header
 * @returns {Promise<CryptoKey>}
 */
async function deriveMasterKey(masterPassword, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─────────────────────────────────────────────
// Vault-Verschlüsselung (für lokales Speichern nach Änderungen)
// ─────────────────────────────────────────────

/**
 * Verschlüsselt die Credential-Liste zu einem Vault-Blob.
 * Format: Salt (32B) + IV (12B) + AES-GCM-Ciphertext.
 *
 * @param {Array} credentials – Die Credential-Liste
 * @param {string} masterPassword – Das Master-Passwort
 * @returns {Promise<string>} – Base64-kodierter verschlüsselter Vault
 */
async function encryptVault(credentials, masterPassword) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const masterKey = await deriveMasterKey(masterPassword, salt);

  const jsonStr = JSON.stringify(credentials);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    encoder.encode(jsonStr)
  );

  // Vault zusammenbauen: Salt | IV | Ciphertext
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const vault = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertextBytes.length);
  vault.set(salt, 0);
  vault.set(iv, SALT_LENGTH);
  vault.set(ciphertextBytes, SALT_LENGTH + IV_LENGTH);

  return arrayBufferToBase64(vault.buffer);
}
