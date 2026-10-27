const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_LENGTH = 256;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

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

async function decryptMasterKeyWithPin(pin, encryptedMasterKey, saltBase64, ivBase64) {
  const salt = base64ToArrayBuffer(saltBase64);
  const pinKey = await derivePinKey(pin, salt);
  return decryptAesGcm(pinKey, encryptedMasterKey, ivBase64);
}

async function decryptVault(encryptedVaultBase64, masterPassword) {
  const vaultBuffer = base64ToArrayBuffer(encryptedVaultBase64);
  const vaultBytes = new Uint8Array(vaultBuffer);

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

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const vault = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertextBytes.length);
  vault.set(salt, 0);
  vault.set(iv, SALT_LENGTH);
  vault.set(ciphertextBytes, SALT_LENGTH + IV_LENGTH);

  return arrayBufferToBase64(vault.buffer);
}
