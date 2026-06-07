const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Tray, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const os = require('os');
const net = require('net');

const allowedPaths = new Set();

// Single-instance lock: prevent multiple background processes
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// Restore original white locked.png from BrowserExtension icons during development
if (!app.isPackaged) {
    try {
        const fsSync = require('fs');
        const src = path.join(__dirname, '..', 'BrowserExtension', 'icons', 'icon48.png');
        const dest = path.join(__dirname, '..', 'logos', 'locked.png');
        if (fsSync.existsSync(src) && fsSync.existsSync(path.dirname(dest))) {
            fsSync.copyFileSync(src, dest);
        }
    } catch (restoreErr) {
        console.error('Failed to restore original locked.png:', restoreErr);
    }
}

const DATA_DIR = path.join(app.getPath('appData'), 'PassSafer', 'PassSaferData');
const MASTER_HASH_FILE = path.join(DATA_DIR, '.mh');
const PIN_HASH_FILE = path.join(DATA_DIR, '.ph');
const PASSWORDS_FILE = path.join(DATA_DIR, '.pw');
const LICENSE_FILE = path.join(DATA_DIR, '.lic');
const DEVICE_ID_FILE = path.join(DATA_DIR, '.did');
const IDS_FILE = path.join(DATA_DIR, '.id');
const DOCUMENTS_FILE = path.join(DATA_DIR, '.doc');
const CARDS_FILE = path.join(DATA_DIR, '.card');
const REPORTS_FILE = path.join(DATA_DIR, '.report');

// In-Memory Master Key für Sync-Push an Browser-Erweiterung
let inMemoryMasterPassword = null;

let mainWindow;

// --tray Support: Lautloser Start ohne sichtbares Fenster
const isTrayStart = process.argv.includes('--tray');

// Erstelle App-Fenster
function createWindow() {
    // Force dark theme native title bar/controls even on light OS themes
    nativeTheme.themeSource = 'dark';

    mainWindow = new BrowserWindow({
        width: 1300,
        height: 800,
        minWidth: 900,
        minHeight: 650,
        show: !isTrayStart, // Bei --tray nicht anzeigen
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        frame: true,
        backgroundColor: '#2d2d2d',
        icon: path.join(__dirname, '..', 'logos', 'logo_win_linx.ico')
    });

    mainWindow.loadFile('index.html');
    mainWindow.removeMenu(); // Menüleiste entfernen

    // [HOCH-01] DevTools aktiv blockieren in Production
    mainWindow.webContents.on('devtools-opened', () => {
        mainWindow.webContents.closeDevTools();
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' ||
            (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
            event.preventDefault();
        }
    });

    // Content Security Policy – erweitert um HaveIBeenPwned API
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data:; " +
                    "font-src 'self'; " +
                    "connect-src 'self' https://passsafer-api.zyniotech.workers.dev https://api.pwnedpasswords.com;"
                ]
            }
        });
    });
}

app.whenReady().then(async () => {
    await ensureDataDir();
    createWindow();
    checkForUpdates();

    // Generate IPC auth token and write to file
    const ipcAuthToken = crypto.randomBytes(32).toString('hex');
    const IPC_TOKEN_FILE = path.join(DATA_DIR, '.ipc_token');
    await fs.writeFile(IPC_TOKEN_FILE, ipcAuthToken, 'utf8');
    try { await setSecurePermissions(IPC_TOKEN_FILE); } catch (e) {}

    startIpcServer(ipcAuthToken);

    // System Tray Icon (only in --tray background mode)
    if (isTrayStart) {
        const iconPath = path.join(__dirname, '..', 'logos', 'logo_win_linx.ico');
        const tray = new Tray(iconPath);
        tray.setToolTip('PassSafer – Background Service');
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Open PassSafer', click: () => { mainWindow.show(); mainWindow.focus(); } },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() }
        ]));
        tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
    }

    // Idle auto-shutdown (only in --tray background mode)
    if (isTrayStart) {
        let lastIpcActivity = Date.now();
        const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

        // Expose activity tracker for IPC server
        global.touchIpcActivity = () => { lastIpcActivity = Date.now(); };

        setInterval(() => {
            if (!mainWindow.isVisible() && (Date.now() - lastIpcActivity > IDLE_TIMEOUT_MS)) {
                console.log('[PassSafer] Idle timeout reached – shutting down background process.');
                app.quit();
            }
        }, 60_000);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Stelle sicher dass Daten-Verzeichnis existiert
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating data directory:', err);
    }
}

// [HOCH-02] Login Attempt Tracker - Global (nicht Username-basiert, nicht umgehbar)
class LoginAttemptTracker {
    constructor() {
        this.count = 0;
        this.lockoutUntil = 0;
        this.MAX_ATTEMPTS = 5;
        this.LOCKOUT_DURATION = 5 * 60 * 1000; // 5 Minutes
    }

    recordAttempt() {
        const now = Date.now();

        // Check if locked out
        if (now < this.lockoutUntil) {
            return false; // Still locked
        }

        // Reset after lockout expires
        if (this.lockoutUntil > 0 && now >= this.lockoutUntil) {
            this.lockoutUntil = 0;
            this.count = 0;
        }

        this.count++;

        if (this.count >= this.MAX_ATTEMPTS) {
            this.lockoutUntil = now + this.LOCKOUT_DURATION;
            return false;
        }

        return true;
    }

    resetAttempts() {
        this.count = 0;
        this.lockoutUntil = 0;
    }

    getRemainingLockoutTime() {
        if (!this.lockoutUntil) return 0;
        const remaining = this.lockoutUntil - Date.now();
        return remaining > 0 ? remaining : 0;
    }
}

const loginTracker = new LoginAttemptTracker();

// ═══════════════════════════════════════════════════════════════════════
// KRYPTOGRAPHIE: Scrypt-basiertes Hashing & Schlüsselableitung
// Scrypt-Parameter: N=16384, r=8, p=1 (speicherintensiv, brute-force-resistent)
// ═══════════════════════════════════════════════════════════════════════

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Hash-Funktionen mit Scrypt (Upgrade von PBKDF2)
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex');
}

// Legacy PBKDF2 Hash (nur für Migration)
function hashPasswordPBKDF2(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, hash, salt) {
    const passwordHash = hashPassword(password, salt);
    const hashBuffer = Buffer.from(hash, 'hex');
    const inputBuffer = Buffer.from(passwordHash, 'hex');
    if (hashBuffer.length !== inputBuffer.length) return false;
    return crypto.timingSafeEqual(hashBuffer, inputBuffer);
}

// Legacy PBKDF2 Verifikation (für Migration)
function verifyPasswordPBKDF2(password, hash, salt) {
    const passwordHash = hashPasswordPBKDF2(password, salt);
    const hashBuffer = Buffer.from(hash, 'hex');
    const inputBuffer = Buffer.from(passwordHash, 'hex');
    if (hashBuffer.length !== inputBuffer.length) return false;
    return crypto.timingSafeEqual(hashBuffer, inputBuffer);
}

// Verschlüsselungs-Funktionen mit Scrypt
function deriveKey(password, salt) {
    return crypto.scryptSync(password, salt, 32, SCRYPT_PARAMS);
}

// Legacy PBKDF2 Key Derivation (für Migration)
function deriveKeyPBKDF2(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

// [KRIT-02] AES-256-GCM Encryption (Authenticated Encryption)
function encrypt(text, password, salt) {
    const key = deriveKey(password, salt);
    const iv = crypto.randomBytes(12); // 12 bytes for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return 'v2:' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(encryptedData, password, salt) {
    const key = deriveKey(password, salt);

    if (encryptedData.startsWith('v2:')) {
        // GCM format: v2:iv:authTag:encrypted
        const parts = encryptedData.substring(3).split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } else {
        // Legacy CBC format: iv:encrypted (backward compatibility)
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

// Decrypt mit Legacy PBKDF2-Schlüssel (für Migration)
function decryptWithPBKDF2(encryptedData, password, salt) {
    const key = deriveKeyPBKDF2(password, salt);

    if (encryptedData.startsWith('v2:')) {
        const parts = encryptedData.substring(3).split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } else {
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

// [KRIT-01] Export mit zufälligem Salt + GCM
function encryptExport(text, password) {
    const exportSalt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(password, exportSalt, 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return 'v2:' + exportSalt.toString('hex') + ':' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptExport(encryptedData, password) {
    if (encryptedData.startsWith('v2:')) {
        // New format: v2:salt:iv:authTag:encrypted
        const parts = encryptedData.substring(3).split(':');
        const exportSalt = Buffer.from(parts[0], 'hex');
        const iv = Buffer.from(parts[1], 'hex');
        const authTag = Buffer.from(parts[2], 'hex');
        const encrypted = parts[3];
        const key = crypto.pbkdf2Sync(password, exportSalt, 100000, 32, 'sha256');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } else {
        //Legacy format: iv:encrypted (fixed salt, CBC) - backward compatibility
        const exportSalt = Buffer.from('export_salt_for_passsafer_app_12345');
        const key = crypto.pbkdf2Sync(password, exportSalt, 100000, 32, 'sha256');
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

async function setSecurePermissions(filePath) {
    try {
        await fs.chmod(filePath, 0o600); // Read/Write for owner only
    } catch (err) {
        // Ignore errors on Windows if not supported perfectly
    }
}


// Prüfe ob erste Nutzung
ipcMain.handle('check-first-run', async () => {
    try {
        await fs.access(MASTER_HASH_FILE);
        return false; // Nicht erste Nutzung
    } catch {
        return true; // Erste Nutzung
    }
});

// Registrierung
ipcMain.handle('register', async (event, { username, password, pin }) => {
    try {
        await ensureDataDir(); // Ensure directory exists (important if account was just deleted)

        const masterSalt = crypto.randomBytes(16).toString('hex');
        const pinSalt = crypto.randomBytes(16).toString('hex');

        const masterHash = hashPassword(password, masterSalt);
        const pinHash = hashPassword(pin, pinSalt);

        await fs.writeFile(MASTER_HASH_FILE, JSON.stringify({ hash: masterHash, salt: masterSalt }));
        await setSecurePermissions(MASTER_HASH_FILE);

        await fs.writeFile(PIN_HASH_FILE, JSON.stringify({ hash: pinHash, salt: pinSalt }));
        await setSecurePermissions(PIN_HASH_FILE);

        // Initialisiere leere Passwort-Datei
        const storageSalt = crypto.randomBytes(16).toString('hex');
        const initialData = { folders: [], passwords: [] };
        const encrypted = encrypt(JSON.stringify(initialData), password, storageSalt);

        await fs.writeFile(PASSWORDS_FILE, JSON.stringify({ salt: storageSalt, data: encrypted }));
        await setSecurePermissions(PASSWORDS_FILE);

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Login - [HOCH-02] Globaler Brute-Force-Schutz + Scrypt-Migration
ipcMain.handle('login', async (event, { username, password, pin }) => {
    try {
        // Brute Force Schutz - global, nicht umgehbar durch Username-Wechsel
        if (!loginTracker.recordAttempt()) {
            const remaining = Math.ceil(loginTracker.getRemainingLockoutTime() / 1000);
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            return { success: false, error: `Zu viele Versuche. Bitte warte ${minutes}m ${seconds}s.` };
        }

        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE, 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE, 'utf8'));

        let masterValid = verifyPassword(password, masterData.hash, masterData.salt);
        let pinValid = verifyPassword(pin, pinData.hash, pinData.salt);
        let needsMigration = false;

        // Fallback: PBKDF2-Verifikation für nahtlose Migration
        if (!masterValid) {
            masterValid = verifyPasswordPBKDF2(password, masterData.hash, masterData.salt);
            if (masterValid) needsMigration = true;
        }
        if (!pinValid) {
            pinValid = verifyPasswordPBKDF2(pin, pinData.hash, pinData.salt);
            if (pinValid && masterValid) needsMigration = true;
        }

        if (masterValid && pinValid) {
            loginTracker.resetAttempts();
            inMemoryMasterPassword = password;

            // Transparente Scrypt-Migration bei erstem Login nach Update
            if (needsMigration) {
                try {
                    console.log('[PassSafer] Migrating credentials from PBKDF2 to Scrypt...');

                    // Master-Hash mit Scrypt neu berechnen
                    const newMasterSalt = crypto.randomBytes(16).toString('hex');
                    const newMasterHash = hashPassword(password, newMasterSalt);
                    await fs.writeFile(MASTER_HASH_FILE, JSON.stringify({ hash: newMasterHash, salt: newMasterSalt, kdf: 'scrypt' }));
                    await setSecurePermissions(MASTER_HASH_FILE);

                    // PIN-Hash mit Scrypt neu berechnen
                    const newPinSalt = crypto.randomBytes(16).toString('hex');
                    const newPinHash = hashPassword(pin, newPinSalt);
                    await fs.writeFile(PIN_HASH_FILE, JSON.stringify({ hash: newPinHash, salt: newPinSalt, kdf: 'scrypt' }));
                    await setSecurePermissions(PIN_HASH_FILE);

                    // Passwort-Datenbank neu verschlüsseln mit Scrypt-Key
                    const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE, 'utf8'));
                    let decryptedData;
                    try {
                        decryptedData = decrypt(fileData.data, password, fileData.salt);
                    } catch {
                        decryptedData = decryptWithPBKDF2(fileData.data, password, fileData.salt);
                    }
                    const newStorageSalt = crypto.randomBytes(16).toString('hex');
                    const reEncrypted = encrypt(decryptedData, password, newStorageSalt);
                    await fs.writeFile(PASSWORDS_FILE, JSON.stringify({ salt: newStorageSalt, data: reEncrypted, kdf: 'scrypt' }));
                    await setSecurePermissions(PASSWORDS_FILE);

                    console.log('[PassSafer] Scrypt migration completed successfully.');
                } catch (migrationErr) {
                    console.error('[PassSafer] Scrypt migration failed (non-critical):', migrationErr.message);
                }
            }

            return { success: true };
        } else {
            return { success: false, error: 'Ungültige Zugangsdaten' };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Lade Passwörter (mit PBKDF2-Fallback für Migration)
ipcMain.handle('load-passwords', async (event, { password }) => {
    try {
        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE, 'utf8'));
        let decryptedData;
        try {
            decryptedData = decrypt(fileData.data, password, fileData.salt);
        } catch {
            // Fallback: PBKDF2-Entschlüsselung für Legacy-Datenbanken
            decryptedData = decryptWithPBKDF2(fileData.data, password, fileData.salt);
        }
        const parsedData = JSON.parse(decryptedData);

        return {
            success: true,
            data: parsedData.passwords || parsedData.data || [],
            folders: parsedData.folders || [],
            trash: parsedData.trash || []
        };
    } catch (error) {
        return { success: false, error: error.message, data: [], folders: [], trash: [] };
    }
});

// Speichere Passwörter + Sync-Push an Browser-Erweiterung
ipcMain.handle('save-passwords', async (event, { password, passwords, folders, trash }) => {
    try {
        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE, 'utf8'));
        const salt = fileData.salt;

        const dataToSave = { passwords, folders, trash };
        const encrypted = encrypt(JSON.stringify(dataToSave), password, salt);

        await fs.writeFile(PASSWORDS_FILE, JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(PASSWORDS_FILE);

        // Sync-Push an verbundene Browser-Erweiterung (falls IPC-Server aktiv)
        pushSyncToExtension(salt, encrypted);

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// PIN ändern
ipcMain.handle('change-pin', async (event, { currentPassword, currentPin, newPin }) => {
    try {
        // Verifiziere aktuelle Credentials
        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE, 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE, 'utf8'));

        const masterValid = verifyPassword(currentPassword, masterData.hash, masterData.salt);
        const pinValid = verifyPassword(currentPin, pinData.hash, pinData.salt);

        if (!masterValid || !pinValid) {
            return { success: false, error: 'Ungültige Zugangsdaten' };
        }

        // Speichere neuen PIN
        const newPinSalt = crypto.randomBytes(16).toString('hex');
        const newPinHash = hashPassword(newPin, newPinSalt);

        await fs.writeFile(PIN_HASH_FILE, JSON.stringify({ hash: newPinHash, salt: newPinSalt }));
        await setSecurePermissions(PIN_HASH_FILE);

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Master-Passwort ändern
ipcMain.handle('change-password', async (event, { currentPassword, currentPin, newPassword }) => {
    try {
        // Verifiziere aktuelle Credentials
        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE, 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE, 'utf8'));

        const masterValid = verifyPassword(currentPassword, masterData.hash, masterData.salt);
        const pinValid = verifyPassword(currentPin, pinData.hash, pinData.salt);

        if (!masterValid || !pinValid) {
            return { success: false, error: 'Ungültige Zugangsdaten' };
        }

        // Lade und entschlüssele Daten mit altem Passwort
        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE, 'utf8'));
        const decryptedData = decrypt(fileData.data, currentPassword, fileData.salt);

        // Speichere neues Master-Passwort Hash
        const newMasterSalt = crypto.randomBytes(16).toString('hex');
        const newMasterHash = hashPassword(newPassword, newMasterSalt);
        await fs.writeFile(MASTER_HASH_FILE, JSON.stringify({ hash: newMasterHash, salt: newMasterSalt }));
        await setSecurePermissions(MASTER_HASH_FILE);

        // Re-verschlüssele Daten mit neuem Passwort
        const newStorageSalt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(decryptedData, newPassword, newStorageSalt);
        await fs.writeFile(PASSWORDS_FILE, JSON.stringify({ salt: newStorageSalt, data: encrypted }));
        await setSecurePermissions(PASSWORDS_FILE);

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Helper to resolve canonical paths to handle Windows 8.3 short name and symlink bypasses
async function getCanonicalPath(filePath) {
    try {
        return await fs.realpath(filePath);
    } catch {
        try {
            const parent = path.dirname(filePath);
            const realParent = await fs.realpath(parent);
            return path.join(realParent, path.basename(filePath));
        } catch {
            return path.resolve(filePath);
        }
    }
}

// Export Passwords
ipcMain.handle('export-passwords', async (event, { password, filePath, data }) => {
    try {
        // Validate file extension
        if (!filePath.toLowerCase().endsWith('.pass')) {
            return { success: false, error: 'Invalid file type. Only .pass files are allowed.' };
        }
        const canonical = await getCanonicalPath(filePath);
        const resolved = path.resolve(canonical).toLowerCase();
        if (!allowedPaths.has(resolved)) {
            return { success: false, error: 'Access to this file path is not authorized.' };
        }
        if (!(await isPathSafe(filePath))) {
            return { success: false, error: 'Access to this location is not allowed.' };
        }
        // Verschlüssele Daten mit Export-Passwort und zufälligem Salt
        const encrypted = encryptExport(JSON.stringify(data), password);
        await fs.writeFile(filePath, encrypted);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Import Passwords
ipcMain.handle('import-passwords', async (event, { password, filePath }) => {
    try {
        // Validate file extension
        if (!filePath.toLowerCase().endsWith('.pass')) {
            return { success: false, error: 'Invalid file type. Only .pass files are allowed.' };
        }
        const canonical = await getCanonicalPath(filePath);
        const resolved = path.resolve(canonical).toLowerCase();
        if (!allowedPaths.has(resolved)) {
            return { success: false, error: 'Access to this file path is not authorized.' };
        }
        if (!(await isPathSafe(filePath))) {
            return { success: false, error: 'Access to this location is not allowed.' };
        }
        const fileContent = await fs.readFile(filePath, 'utf8');
        const decrypted = decryptExport(fileContent, password);
        const data = JSON.parse(decrypted);
        return { success: true, data };
    } catch (error) {
        return { success: false, error: 'Import failed: Incorrect password or corrupted file' };
    }
});

// [HOCH-03] Account löschen - jetzt mit PIN-Verifikation
ipcMain.handle('delete-account', async (event, { password, pin }) => {
    try {
        // Verifiziere Passwort UND PIN vor dem Löschen
        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE, 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE, 'utf8'));

        const masterValid = verifyPassword(password, masterData.hash, masterData.salt);
        const pinValid = verifyPassword(pin, pinData.hash, pinData.salt);

        if (!masterValid || !pinValid) {
            return { success: false, error: 'Invalid credentials' };
        }

        // Lösche alle Daten
        await fs.unlink(MASTER_HASH_FILE);
        await fs.unlink(PIN_HASH_FILE);
        await fs.unlink(PASSWORDS_FILE);
        try { await fs.unlink(IDS_FILE); } catch (e) {}
        try { await fs.unlink(DOCUMENTS_FILE); } catch (e) {}
        try { await fs.unlink(CARDS_FILE); } catch (e) {}
        try { await fs.unlink(REPORTS_FILE); } catch (e) {}

        // Optional: Lösche Data Directory wenn leer
        try {
            await fs.rmdir(DATA_DIR);
        } catch (e) {
            // Ignorieren wenn nicht leer
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// [HOCH-04] Path safety check - verbessert gegen Traversal und UNC
async function isPathSafe(filePath) {
    const canonical = await getCanonicalPath(filePath);
    const resolved = path.resolve(canonical);

    // Block UNC paths (network shares)
    if (resolved.startsWith('\\\\') || resolved.startsWith('//')) return false;

    // Block path traversal attempts
    if (filePath.includes('..') || resolved.includes('..')) return false;

    const dangerous = [
        path.join(process.env.SystemRoot || 'C:\\Windows'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'),
        '/usr', '/etc', '/bin', '/sbin', '/var', '/sys', // Linux/Mac paths
        DATA_DIR // Protect own data directory
    ].map(p => p.toLowerCase());
    
    const resolvedLower = resolved.toLowerCase();
    
    // Check if resolved path is inside or identical to any dangerous directory
    for (const d of dangerous) {
        if (resolvedLower === d || resolvedLower.startsWith(d + path.sep)) {
            return false;
        }
    }
    return true;
}

// Read File (for file attachment upload)
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const canonical = await getCanonicalPath(filePath);
        const resolved = path.resolve(canonical).toLowerCase();
        if (!allowedPaths.has(resolved)) {
            return { success: false, error: 'Access to this file path is not authorized.' };
        }
        if (!(await isPathSafe(filePath))) {
            return { success: false, error: 'Access to this location is not allowed.' };
        }
        const stats = await fs.stat(filePath);
        // [MITTEL-06] Fix: Kommentar und Code stimmen jetzt überein
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
        if (stats.size > MAX_FILE_SIZE) {
            return { success: false, error: `File too large. Maximum size is 100 MB.` };
        }
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString('base64');
        const fileName = path.basename(filePath);
        return { success: true, data: base64, fileName };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Write File (for file attachment download)
ipcMain.handle('write-file', async (event, { filePath, data }) => {
    try {
        const canonical = await getCanonicalPath(filePath);
        const resolved = path.resolve(canonical).toLowerCase();
        if (!allowedPaths.has(resolved)) {
            return { success: false, error: 'Access to this file path is not authorized.' };
        }
        if (!(await isPathSafe(filePath))) {
            return { success: false, error: 'Access to this location is not allowed.' };
        }
        const buffer = Buffer.from(data, 'base64');
        await fs.writeFile(filePath, buffer);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Show Save Dialog
ipcMain.handle('show-save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    if (result && result.filePath) {
        allowedPaths.add(path.resolve(result.filePath).toLowerCase());
        try {
            const canonical = await getCanonicalPath(result.filePath);
            allowedPaths.add(path.resolve(canonical).toLowerCase());
        } catch (e) {}
    }
    return result;
});

// Show Open Dialog
ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    if (result && result.filePaths) {
        for (const fp of result.filePaths) {
            allowedPaths.add(path.resolve(fp).toLowerCase());
            try {
                const canonical = await getCanonicalPath(fp);
                allowedPaths.add(path.resolve(canonical).toLowerCase());
            } catch (e) {}
        }
    }
    return result;
});

// Open external URL (for links)
ipcMain.handle('open-external', async (event, url) => {
    try {
        let targetUrl = url;
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
            // No protocol, default to https
            targetUrl = 'https://' + url;
        }
        const parsedUrl = new URL(targetUrl);
        if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
            await shell.openExternal(targetUrl);
        } else {
            console.warn('Rejected dangerous protocol:', parsedUrl.protocol);
        }
    } catch (err) {
        console.error('Invalid URL passed to open-external:', url, err);
    }
});

// Clipboard operations (for secure clipboard access from renderer)
ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
    return { success: true };
});

ipcMain.handle('clear-clipboard', () => {
    clipboard.writeText('');
    return { success: true };
});

// Licensing Helpers
function getLicenseKeyForEncryption(deviceId) {
    return crypto.pbkdf2Sync(deviceId, 'license-salt-12893812903', 1000, 32, 'sha256');
}

function encryptLicense(data, deviceId) {
    const key = getLicenseKeyForEncryption(deviceId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return 'v1:' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptLicense(encryptedData, deviceId) {
    const key = getLicenseKeyForEncryption(deviceId);
    const parts = encryptedData.substring(3).split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

// Licensing IPC Handlers
ipcMain.handle('get-device-id', async () => {
    try {
        let deviceId;
        try {
            deviceId = await fs.readFile(DEVICE_ID_FILE, 'utf8');
        } catch {
            deviceId = crypto.randomUUID();
            await fs.writeFile(DEVICE_ID_FILE, deviceId, 'utf8');
            await setSecurePermissions(DEVICE_ID_FILE);
        }
        return deviceId;
    } catch (error) {
        console.error('Error getting device ID:', error);
        return 'device-' + crypto.randomBytes(8).toString('hex');
    }
});

ipcMain.handle('load-license', async () => {
    try {
        const deviceId = await fs.readFile(DEVICE_ID_FILE, 'utf8');
        const fileContent = await fs.readFile(LICENSE_FILE, 'utf8');
        const licenseData = decryptLicense(fileContent, deviceId);
        return { success: true, license: licenseData };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-license', async (event, licenseData) => {
    try {
        let deviceId;
        try {
            deviceId = await fs.readFile(DEVICE_ID_FILE, 'utf8');
        } catch {
            deviceId = crypto.randomUUID();
            await fs.writeFile(DEVICE_ID_FILE, deviceId, 'utf8');
            await setSecurePermissions(DEVICE_ID_FILE);
        }
        const encrypted = encryptLicense(licenseData, deviceId);
        await fs.writeFile(LICENSE_FILE, encrypted, 'utf8');
        await setSecurePermissions(LICENSE_FILE);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-license', async () => {
    try {
        await fs.unlink(LICENSE_FILE);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Load encrypted IDs
ipcMain.handle('load-ids', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(IDS_FILE, 'utf8'));
        } catch {
            return { success: true, data: [] }; // File doesn't exist yet
        }
        let decryptedData = decrypt(fileData.data, password, fileData.salt);
        const parsedData = JSON.parse(decryptedData);
        return { success: true, data: parsedData || [] };
    } catch (error) {
        return { success: false, error: error.message, data: [] };
    }
});

// Save encrypted IDs
ipcMain.handle('save-ids', async (event, { password, ids }) => {
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(JSON.stringify(ids), password, salt);
        await fs.writeFile(IDS_FILE, JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(IDS_FILE);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Load encrypted Documents
ipcMain.handle('load-documents', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(DOCUMENTS_FILE, 'utf8'));
        } catch {
            return { success: true, data: [] }; // File doesn't exist yet
        }
        let decryptedData = decrypt(fileData.data, password, fileData.salt);
        const parsedData = JSON.parse(decryptedData);
        return { success: true, data: parsedData || [] };
    } catch (error) {
        return { success: false, error: error.message, data: [] };
    }
});

// Save encrypted Documents
ipcMain.handle('save-documents', async (event, { password, documents }) => {
    try {
        // [HOCH-06] 100MB File size limit check in main process (for documents and attachments)
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
        for (const doc of documents) {
            if (doc.files) {
                for (const f of doc.files) {
                    const approxSize = f.data ? Math.round((f.data.length * 3) / 4) : 0;
                    if (approxSize > MAX_FILE_SIZE) {
                        return { success: false, error: `File too large. Maximum size is 100 MB.` };
                    }
                }
            }
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(JSON.stringify(documents), password, salt);
        await fs.writeFile(DOCUMENTS_FILE, JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(DOCUMENTS_FILE);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ═══════════════════════════════════════════════════════════════════════
// AUTO-UPDATE SYSTEM (via GitHub Releases + electron-updater)
// ═══════════════════════════════════════════════════════════════════════

function checkForUpdates() {
    if (!app.isPackaged) {
        console.log('Auto-update: Skipped (dev mode)');
        return;
    }

    try {
        const { autoUpdater } = require('electron-updater');

        autoUpdater.autoDownload = false; // Disable auto download (Option A)
        autoUpdater.autoInstallOnAppQuit = true;

        // Bypass signature verification to prevent update failures/hangs on Windows
        autoUpdater.verifyUpdateCodeSignature = async (publisherName, path) => {
            return null;
        };

        autoUpdater.on('update-available', (info) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-available', {
                    version: info.version,
                    releaseNotes: info.releaseNotes
                });
            }
        });

        autoUpdater.on('download-progress', (progressObj) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-progress', {
                    percent: progressObj.percent
                });
            }
        });

        autoUpdater.on('update-downloaded', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-downloaded');
            }
        });

        autoUpdater.on('error', (err) => {
            console.error('Auto-update error:', err.message);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-error', err.message);
            }
        });

        autoUpdater.checkForUpdates();
    } catch (err) {
        console.error('Auto-update init error:', err.message);
    }
}

// Download update
ipcMain.handle('download-update', async () => {
    try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.verifyUpdateCodeSignature = async (publisherName, path) => {
            return null;
        };
        autoUpdater.downloadUpdate();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Install update and restart
ipcMain.handle('install-update', async () => {
    try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.quitAndInstall();
    } catch (err) {
        console.error('Install update error:', err.message);
    }
});

// Manual check for updates
ipcMain.handle('manual-check-updates', async () => {
    try {
        if (!app.isPackaged) {
            return { success: false, error: 'Auto-update is only available in packaged app.' };
        }
        const { autoUpdater } = require('electron-updater');
        autoUpdater.verifyUpdateCodeSignature = async (publisherName, path) => {
            return null;
        };
        const result = await autoUpdater.checkForUpdates();
        if (!result || !result.updateInfo) {
            return { success: true, updateAvailable: false };
        }
        const currentVersion = app.getVersion();
        const latestVersion = result.updateInfo.version;
        const updateAvailable = isNewerVersion(currentVersion, latestVersion);
        return { success: true, updateAvailable, updateInfo: result.updateInfo };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Helper for semver comparison
function isNewerVersion(current, latest) {
    const cParts = current.split('.').map(Number);
    const lParts = latest.split('.').map(Number);
    for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
        const c = cParts[i] || 0;
        const l = lParts[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════
// LOCAL IPC BRIDGE FOR BROWSER EXTENSION (NATIVE MESSAGING)
// ═══════════════════════════════════════════════════════════════════════
let ipcServer;
const pendingExtensionRequests = new Map();
const PIPE_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\passsafer-ipc'
    : path.join(os.tmpdir(), 'passsafer-ipc.sock');

function startIpcServer(authToken) {
    // On non-Windows, clean up any existing socket file
    if (process.platform !== 'win32') {
        try {
            require('fs').unlinkSync(PIPE_PATH);
        } catch (e) {}
    }

    ipcServer = net.createServer((socket) => {
        let dataBuffer = '';
        socket.on('data', (chunk) => {
            dataBuffer += chunk.toString();
            if (dataBuffer.endsWith('\n')) {
                try {
                    const parsed = JSON.parse(dataBuffer.trim());

                    // Validate IPC auth token
                    if (!parsed._token || parsed._token !== authToken) {
                        socket.write(JSON.stringify({ success: false, error: 'Unauthorized' }) + '\n');
                        socket.end();
                        return;
                    }
                    delete parsed._token; // Don't forward token to renderer

                    if (global.touchIpcActivity) global.touchIpcActivity();

                    const requestId = crypto.randomUUID();

                    if (!mainWindow || mainWindow.isDestroyed()) {
                        socket.write(JSON.stringify({ success: false, error: 'App window not available' }) + '\n');
                        socket.end();
                        return;
                    }

                    // 5-second timeout for request
                    const timeout = setTimeout(() => {
                        if (pendingExtensionRequests.has(requestId)) {
                            pendingExtensionRequests.delete(requestId);
                            socket.write(JSON.stringify({ success: false, error: 'Timeout waiting for desktop app' }) + '\n');
                            socket.end();
                        }
                    }, 5000);

                    pendingExtensionRequests.set(requestId, { socket, timeout });

                    // Send request to renderer
                    mainWindow.webContents.send('native-request', { id: requestId, request: parsed });
                } catch (e) {
                    socket.write(JSON.stringify({ success: false, error: 'Invalid JSON' }) + '\n');
                    socket.end();
                }
                dataBuffer = '';
            }
        });

        socket.on('error', (err) => {
            console.error('[PassSafer] IPC Socket error:', err);
        });
    });

    ipcServer.listen(PIPE_PATH, () => {
        console.log(`[PassSafer] IPC Server listening on Windows Named Pipe: ${PIPE_PATH}`);
    });

    ipcServer.on('error', (err) => {
        console.error('[PassSafer] IPC Server error:', err);
    });
}

// Handle native response from renderer
ipcMain.on('native-response', (event, { id, response }) => {
    const pending = pendingExtensionRequests.get(id);
    if (pending) {
        clearTimeout(pending.timeout);
        pendingExtensionRequests.delete(id);
        pending.socket.write(JSON.stringify(response) + '\n');
        pending.socket.end();
    }
});

app.on('will-quit', () => {
    if (ipcServer) {
        ipcServer.close();
    }
    // Speicher bereinigen
    inMemoryMasterPassword = null;
});

// ═══════════════════════════════════════════════════════════════════════
// SYNC-PUSH AN BROWSER-ERWEITERUNG
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sendet die aktualisierte verschlüsselte Datenbank über die Named Pipe
 * an die verbundene Browser-Erweiterung, damit diese ihren Cache aktualisieren kann.
 */
function pushSyncToExtension(salt, encryptedData) {
    try {
        const client = net.connect(PIPE_PATH, () => {
            const syncMessage = JSON.stringify({
                action: 'sync-vault-push',
                vault: { salt, data: encryptedData }
            }) + '\n';
            client.write(syncMessage);
            client.end();
        });
        client.on('error', () => {
            // Extension nicht verbunden – ignorieren (ist normal wenn kein native-host läuft)
        });
    } catch (e) {
        // Stille Fehler – Sync-Push ist best-effort
    }
}

// ═══════════════════════════════════════════════════════════════════════
// PASSWORT-SICHERHEITS-AUDIT (Weak, Reused, Leaked via HaveIBeenPwned)
// ═══════════════════════════════════════════════════════════════════════

ipcMain.handle('password-audit', async (event, { password }) => {
    try {
        // 1. Passwörter laden und entschlüsseln
        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE, 'utf8'));
        let decryptedData;
        try {
            decryptedData = decrypt(fileData.data, password, fileData.salt);
        } catch {
            decryptedData = decryptWithPBKDF2(fileData.data, password, fileData.salt);
        }
        const parsedData = JSON.parse(decryptedData);
        const passwords = parsedData.passwords || parsedData.data || [];

        if (passwords.length === 0) {
            return { success: true, results: [] };
        }

        const results = [];

        // 2. Analyse jedes Passworts
        for (const entry of passwords) {
            if (!entry.password) continue;

            const issues = [];
            const pwd = entry.password;

            // Weak Check: < 12 Zeichen oder mangelnde Komplexität
            if (pwd.length < 12) issues.push('weak_short');
            if (!/[A-Z]/.test(pwd)) issues.push('weak_no_upper');
            if (!/[a-z]/.test(pwd)) issues.push('weak_no_lower');
            if (!/[0-9]/.test(pwd)) issues.push('weak_no_digit');
            if (!/[^A-Za-z0-9]/.test(pwd)) issues.push('weak_no_special');

            // Reused Check: identisches Passwort bei mehreren Einträgen
            const reusedCount = passwords.filter(p => p.password === pwd && p !== entry).length;
            if (reusedCount > 0) issues.push('reused');

            // Passwort-Stärke-Score (0-100)
            let strength = 0;
            if (pwd.length >= 8) strength += 20;
            if (pwd.length >= 12) strength += 15;
            if (pwd.length >= 16) strength += 10;
            if (/[A-Z]/.test(pwd)) strength += 10;
            if (/[a-z]/.test(pwd)) strength += 10;
            if (/[0-9]/.test(pwd)) strength += 10;
            if (/[^A-Za-z0-9]/.test(pwd)) strength += 15;
            // Unique chars bonus
            const uniqueChars = new Set(pwd).size;
            if (uniqueChars >= 8) strength += 10;
            strength = Math.min(100, strength);

            results.push({
                app: entry.app,
                username: entry.username || '',
                issues,
                strength,
                reusedCount
            });
        }

        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// HaveIBeenPwned K-Anonymity Leak-Check (SHA-1 Prefix-Abfrage)
ipcMain.handle('check-pwned', async (event, { passwordHash }) => {
    try {
        const prefix = passwordHash.substring(0, 5).toUpperCase();
        const suffix = passwordHash.substring(5).toUpperCase();

        const response = await new Promise((resolve, reject) => {
            const req = https.get(`https://api.pwnedpasswords.com/range/${prefix}`, {
                headers: { 'User-Agent': 'PassSafer-PasswordManager' }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        });

        // Suche nach unserem Hash-Suffix in der Antwort
        const lines = response.split('\n');
        for (const line of lines) {
            const [hashSuffix, count] = line.trim().split(':');
            if (hashSuffix === suffix) {
                return { success: true, pwned: true, count: parseInt(count, 10) };
            }
        }

        return { success: true, pwned: false, count: 0 };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Load encrypted Cards
ipcMain.handle('load-cards', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(CARDS_FILE, 'utf8'));
        } catch (e) {
            return { success: true, data: [] };
        }
        let decryptedData = decrypt(fileData.data, password, fileData.salt);
        const parsedData = JSON.parse(decryptedData);
        return { success: true, data: parsedData || [] };
    } catch (error) {
        return { success: false, error: error.message, data: [] };
    }
});

// Save encrypted Cards
ipcMain.handle('save-cards', async (event, { password, cards }) => {
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(JSON.stringify(cards), password, salt);
        await fs.writeFile(CARDS_FILE, JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(CARDS_FILE);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Load encrypted Reports
ipcMain.handle('load-reports', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(REPORTS_FILE, 'utf8'));
        } catch (e) {
            return { success: true, data: [] };
        }
        let decryptedData = decrypt(fileData.data, password, fileData.salt);
        const parsedData = JSON.parse(decryptedData);
        return { success: true, data: parsedData || [] };
    } catch (error) {
        return { success: false, error: error.message, data: [] };
    }
});

// Save encrypted Reports
ipcMain.handle('save-reports', async (event, { password, reports }) => {
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(JSON.stringify(reports), password, salt);
        await fs.writeFile(REPORTS_FILE, JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(REPORTS_FILE);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
