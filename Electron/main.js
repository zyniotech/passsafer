const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Tray, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const https = require('https');
const os = require('os');
const net = require('net');

const allowedPaths = new Set();

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
const LICENSE_FILE = path.join(DATA_DIR, '.lic');
const DEVICE_ID_FILE = path.join(DATA_DIR, '.did');
const USERS_DIR = path.join(DATA_DIR, 'users');
const SYNC_PAIRS_FILE = path.join(DATA_DIR, '.sync_pairs');
const SETTINGS_FILE = path.join(DATA_DIR, '.settings');

let currentUserDir = null;
let currentUsername = null;

function getUserDir(username) {
    return path.join(USERS_DIR, username);
}
function getUserFile(filename) {
    if (!currentUserDir) throw new Error('No user logged in');
    return path.join(currentUserDir, filename);
}

function MASTER_HASH_FILE() { return getUserFile('.mh'); }
function PIN_HASH_FILE() { return getUserFile('.ph'); }
function PASSWORDS_FILE() { return getUserFile('.pw'); }
function IDS_FILE() { return getUserFile('.id'); }
function DOCUMENTS_FILE() { return getUserFile('.doc'); }
function CARDS_FILE() { return getUserFile('.card'); }
function REPORTS_FILE() { return getUserFile('.report'); }

let inMemoryMasterPassword = null;
let pendingExtensionCredentials = [];
let isSavingPasswords = false;
let pendingSaveQueue = [];

let mainWindow;

const isTrayStart = process.argv.includes('--tray');

function createWindow() {

    nativeTheme.themeSource = 'dark';

    mainWindow = new BrowserWindow({
        width: 1300,
        height: 800,
        minWidth: 900,
        minHeight: 650,
        show: !isTrayStart,
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
    mainWindow.removeMenu();

    mainWindow.webContents.on('devtools-opened', () => {
        mainWindow.webContents.closeDevTools();
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' ||
            (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
            event.preventDefault();
        }
    });

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self' 'unsafe-inline'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: https: http:; " +
                    "font-src 'self'; " +
                    "connect-src 'self' https://passsafer-api.zyniotech.workers.dev https://api.pwnedpasswords.com;"
                ]
            }
        });
    });
}

const EXTENSION_IDS = [
    'iimaibjnobgoecdbaeojkaikbkfbdhme',
    'pgccapkkkbbfeoafdmjibnjkiplnnffn'
];

function registerNativeMessagingHost() {
    try {
        const fsSync = require('fs');
        const { execSync } = require('child_process');

        let nativeHostDir;
        if (app.isPackaged) {

            nativeHostDir = path.join(process.resourcesPath, 'native-host');
        } else {

            nativeHostDir = path.join(__dirname, '..', 'BrowserExtension');
        }

        const nativeHostBat = path.join(nativeHostDir, 'native-host.bat');
        const manifestFile = path.join(nativeHostDir, 'de.passsafer.helper.json');

        if (!fsSync.existsSync(nativeHostBat)) {
            console.warn('[PassSafer] native-host.bat not found at:', nativeHostBat);
            return;
        }

        const manifest = {
            name: 'de.passsafer.helper',
            description: 'PassSafer Native Messaging Host',
            path: nativeHostBat,
            type: 'stdio',
            allowed_origins: EXTENSION_IDS.map(id => `chrome-extension://${id}/`)
        };
        fsSync.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');

        if (process.platform === 'win32') {
            const regPaths = [
                'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\de.passsafer.helper',
                'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts\\de.passsafer.helper',
                'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\de.passsafer.helper'
            ];
            for (const regPath of regPaths) {
                try {
                    execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestFile}" /f`, { stdio: 'ignore' });
                } catch (e) {

                }
            }
            console.log('[PassSafer] Native messaging host registered for Chrome, Brave, and Edge.');
        }
    } catch (err) {
        console.error('[PassSafer] Failed to register native messaging host:', err.message);
    }
}

async function migrateToMultiUser() {

    const oldMH = path.join(DATA_DIR, '.mh');
    try {
        await fs.access(oldMH);
    } catch {
        return;
    }

    const defaultUser = 'default';
    const userDir = getUserDir(defaultUser);
    await fs.mkdir(userDir, { recursive: true });

    const filesToMove = ['.mh', '.ph', '.pw', '.id', '.doc', '.card', '.report'];
    for (const file of filesToMove) {
        const src = path.join(DATA_DIR, file);
        const dest = path.join(userDir, file);
        try {
            await fs.access(src);
            await fs.rename(src, dest);
        } catch (e) {}
    }

    console.log(`[PassSafer] Migrated existing data to users/${defaultUser}/`);
}

app.whenReady().then(async () => {
    await ensureDataDir();
    await migrateToMultiUser();
    createWindow();
    checkForUpdates();

    registerNativeMessagingHost();

    const ipcAuthToken = crypto.randomBytes(32).toString('hex');
    const IPC_TOKEN_FILE = path.join(DATA_DIR, '.ipc_token');
    await fs.writeFile(IPC_TOKEN_FILE, ipcAuthToken, 'utf8');
    try { await setSecurePermissions(IPC_TOKEN_FILE); } catch (e) {}

    startIpcServer(ipcAuthToken);

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

    if (isTrayStart) {
        let lastIpcActivity = Date.now();
        const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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

async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(USERS_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating data directory:', err);
    }
}

class LoginAttemptTracker {
    constructor() {
        this.count = 0;
        this.lockoutUntil = 0;
        this.MAX_ATTEMPTS = 5;
        this.LOCKOUT_DURATION = 5 * 60 * 1000;
    }

    recordAttempt() {
        const now = Date.now();

        if (now < this.lockoutUntil) {
            return false;
        }

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

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex');
}

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

function verifyPasswordPBKDF2(password, hash, salt) {
    const passwordHash = hashPasswordPBKDF2(password, salt);
    const hashBuffer = Buffer.from(hash, 'hex');
    const inputBuffer = Buffer.from(passwordHash, 'hex');
    if (hashBuffer.length !== inputBuffer.length) return false;
    return crypto.timingSafeEqual(hashBuffer, inputBuffer);
}

function deriveKey(password, salt) {
    return crypto.scryptSync(password, salt, 32, SCRYPT_PARAMS);
}

function deriveKeyPBKDF2(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

function encrypt(text, password, salt) {
    const key = deriveKey(password, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return 'v2:' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(encryptedData, password, salt) {
    const key = deriveKey(password, salt);

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
        await fs.chmod(filePath, 0o600);
    } catch (err) {

    }
}

ipcMain.handle('list-users', async () => {
    try {
        const entries = await fs.readdir(USERS_DIR, { withFileTypes: true });
        const users = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {

                try {
                    await fs.access(path.join(USERS_DIR, entry.name, '.mh'));
                    users.push(entry.name);
                } catch {}
            }
        }
        return { success: true, users };
    } catch {
        return { success: true, users: [] };
    }
});

ipcMain.handle('check-user-exists', async (event, { username }) => {
    try {
        await fs.access(path.join(getUserDir(username), '.mh'));
        return true;
    } catch {
        return false;
    }
});

ipcMain.handle('load-settings', async () => {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf8');
        return { success: true, settings: JSON.parse(data) };
    } catch {
        return { success: true, settings: { language: 'en', autoSync: false } };
    }
});

ipcMain.handle('save-settings', async (event, { settings }) => {
    try {
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('check-first-run', async () => {
    try {
        const entries = await fs.readdir(USERS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                try {
                    await fs.access(path.join(USERS_DIR, entry.name, '.mh'));
                    return false;
                } catch {}
            }
        }
        return true;
    } catch {
        return true;
    }
});

ipcMain.handle('register', async (event, { username, password, pin }) => {
    try {
        const userExists = await fs.access(path.join(getUserDir(username), '.mh')).then(() => true).catch(() => false);
        if (userExists) return { success: false, error: 'User already exists' };

        await fs.mkdir(getUserDir(username), { recursive: true });
        currentUserDir = getUserDir(username);
        currentUsername = username;

        await ensureDataDir();
    await migrateToMultiUser();

        const masterSalt = crypto.randomBytes(16).toString('hex');
        const pinSalt = crypto.randomBytes(16).toString('hex');

        const masterHash = hashPassword(password, masterSalt);
        const pinHash = hashPassword(pin, pinSalt);

        await fs.writeFile(MASTER_HASH_FILE(), JSON.stringify({ hash: masterHash, salt: masterSalt }));
        await setSecurePermissions(MASTER_HASH_FILE());

        await fs.writeFile(PIN_HASH_FILE(), JSON.stringify({ hash: pinHash, salt: pinSalt }));
        await setSecurePermissions(PIN_HASH_FILE());

        const storageSalt = crypto.randomBytes(16).toString('hex');
        const initialData = { folders: [], passwords: [] };
        const encrypted = encrypt(JSON.stringify(initialData), password, storageSalt);

        await fs.writeFile(PASSWORDS_FILE(), JSON.stringify({ salt: storageSalt, data: encrypted }));
        await setSecurePermissions(PASSWORDS_FILE());

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('login', async (event, { username, password, pin }) => {
    try {
        currentUserDir = getUserDir(username);
        currentUsername = username;

        if (!loginTracker.recordAttempt()) {
            const remaining = Math.ceil(loginTracker.getRemainingLockoutTime() / 1000);
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            return { success: false, error: `Zu viele Versuche. Bitte warte ${minutes}m ${seconds}s.` };
        }

        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE(), 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE(), 'utf8'));

        let masterValid = verifyPassword(password, masterData.hash, masterData.salt);
        let pinValid = verifyPassword(pin, pinData.hash, pinData.salt);
        let needsMigration = false;

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

            if (needsMigration) {
                try {
                    console.log('[PassSafer] Migrating credentials from PBKDF2 to Scrypt...');

                    const newMasterSalt = crypto.randomBytes(16).toString('hex');
                    const newMasterHash = hashPassword(password, newMasterSalt);
                    await fs.writeFile(MASTER_HASH_FILE(), JSON.stringify({ hash: newMasterHash, salt: newMasterSalt, kdf: 'scrypt' }));
                    await setSecurePermissions(MASTER_HASH_FILE());

                    const newPinSalt = crypto.randomBytes(16).toString('hex');
                    const newPinHash = hashPassword(pin, newPinSalt);
                    await fs.writeFile(PIN_HASH_FILE(), JSON.stringify({ hash: newPinHash, salt: newPinSalt, kdf: 'scrypt' }));
                    await setSecurePermissions(PIN_HASH_FILE());

                    const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE(), 'utf8'));
                    let decryptedData;
                    try {
                        decryptedData = decrypt(fileData.data, password, fileData.salt);
                    } catch {
                        decryptedData = decryptWithPBKDF2(fileData.data, password, fileData.salt);
                    }
                    const newStorageSalt = crypto.randomBytes(16).toString('hex');
                    const reEncrypted = encrypt(decryptedData, password, newStorageSalt);
                    await fs.writeFile(PASSWORDS_FILE(), JSON.stringify({ salt: newStorageSalt, data: reEncrypted, kdf: 'scrypt' }));
                    await setSecurePermissions(PASSWORDS_FILE());

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

ipcMain.handle('load-passwords', async (event, { password }) => {
    try {
        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE(), 'utf8'));
        let decryptedData;
        try {
            decryptedData = decrypt(fileData.data, password, fileData.salt);
        } catch {

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

ipcMain.handle('save-passwords', async (event, { password, passwords, folders, trash }) => {
    if (isSavingPasswords) {
        await new Promise(resolve => pendingSaveQueue.push(resolve));
    }
    isSavingPasswords = true;
    try {
        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE(), 'utf8'));
        const salt = fileData.salt;

        const dataToSave = { passwords, folders, trash };
        const encrypted = encrypt(JSON.stringify(dataToSave), password, salt);

        await fs.writeFile(PASSWORDS_FILE(), JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(PASSWORDS_FILE());

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        isSavingPasswords = false;
        if (pendingSaveQueue.length > 0) {
            const next = pendingSaveQueue.shift();
            next();
        }
    }
});

ipcMain.handle('change-pin', async (event, { currentPassword, currentPin, newPin }) => {
    try {

        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE(), 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE(), 'utf8'));

        const masterValid = verifyPassword(currentPassword, masterData.hash, masterData.salt);
        const pinValid = verifyPassword(currentPin, pinData.hash, pinData.salt);

        if (!masterValid || !pinValid) {
            return { success: false, error: 'Ungültige Zugangsdaten' };
        }

        const newPinSalt = crypto.randomBytes(16).toString('hex');
        const newPinHash = hashPassword(newPin, newPinSalt);

        await fs.writeFile(PIN_HASH_FILE(), JSON.stringify({ hash: newPinHash, salt: newPinSalt }));
        await setSecurePermissions(PIN_HASH_FILE());

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('change-password', async (event, { currentPassword, currentPin, newPassword }) => {
    try {

        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE(), 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE(), 'utf8'));

        const masterValid = verifyPassword(currentPassword, masterData.hash, masterData.salt);
        const pinValid = verifyPassword(currentPin, pinData.hash, pinData.salt);

        if (!masterValid || !pinValid) {
            return { success: false, error: 'Ungültige Zugangsdaten' };
        }

        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE(), 'utf8'));
        const decryptedData = decrypt(fileData.data, currentPassword, fileData.salt);

        const newMasterSalt = crypto.randomBytes(16).toString('hex');
        const newMasterHash = hashPassword(newPassword, newMasterSalt);
        await fs.writeFile(MASTER_HASH_FILE(), JSON.stringify({ hash: newMasterHash, salt: newMasterSalt }));
        await setSecurePermissions(MASTER_HASH_FILE());

        const newStorageSalt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(decryptedData, newPassword, newStorageSalt);
        await fs.writeFile(PASSWORDS_FILE(), JSON.stringify({ salt: newStorageSalt, data: encrypted }));
        await setSecurePermissions(PASSWORDS_FILE());

        inMemoryMasterPassword = newPassword;

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

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

ipcMain.handle('export-passwords', async (event, { password, filePath, data }) => {
    try {

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

        const encrypted = encryptExport(JSON.stringify(data), password);
        await fs.writeFile(filePath, encrypted);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('import-passwords', async (event, { password, filePath }) => {
    try {

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

ipcMain.handle('delete-account', async (event, { password, pin }) => {
    try {
        if (!currentUserDir) return { success: false, error: 'No user logged in' };

        const masterData = JSON.parse(await fs.readFile(MASTER_HASH_FILE(), 'utf8'));
        const pinData = JSON.parse(await fs.readFile(PIN_HASH_FILE(), 'utf8'));

        const masterValid = verifyPassword(password, masterData.hash, masterData.salt);
        const pinValid = verifyPassword(pin, pinData.hash, pinData.salt);

        if (!masterValid || !pinValid) {
            return { success: false, error: 'Invalid credentials' };
        }

        await fs.rm(currentUserDir, { recursive: true, force: true });
        currentUserDir = null;
        currentUsername = null;

        try {
            await fs.rmdir(DATA_DIR);
        } catch (e) {

        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

async function isPathSafe(filePath) {
    const canonical = await getCanonicalPath(filePath);
    const resolved = path.resolve(canonical);

    if (resolved.startsWith('\\\\') || resolved.startsWith('//')) return false;

    if (filePath.includes('..') || resolved.includes('..')) return false;

    const dangerous = [
        path.join(process.env.SystemRoot || 'C:\\Windows'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'),
        '/usr', '/etc', '/bin', '/sbin', '/var', '/sys',
        DATA_DIR
    ].map(p => p.toLowerCase());

    const resolvedLower = resolved.toLowerCase();

    for (const d of dangerous) {
        if (resolvedLower === d || resolvedLower.startsWith(d + path.sep)) {
            return false;
        }
    }
    return true;
}

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

        const MAX_FILE_SIZE = 100 * 1024 * 1024;
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

ipcMain.handle('open-external', async (event, url) => {
    try {
        let targetUrl = url;
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {

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

ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
    return { success: true };
});

ipcMain.handle('clear-clipboard', () => {
    clipboard.writeText('');
    return { success: true };
});

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

ipcMain.handle('load-ids', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(IDS_FILE(), 'utf8'));
        } catch {
            return { success: true, data: [] };
        }
        let decryptedData = decrypt(fileData.data, password, fileData.salt);
        const parsedData = JSON.parse(decryptedData);
        return { success: true, data: parsedData || [] };
    } catch (error) {
        return { success: false, error: error.message, data: [] };
    }
});

ipcMain.handle('save-ids', async (event, { password, ids }) => {
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(JSON.stringify(ids), password, salt);
        await fs.writeFile(IDS_FILE(), JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(IDS_FILE());
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('load-documents', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(DOCUMENTS_FILE(), 'utf8'));
        } catch {
            return { success: true, data: [] };
        }
        let decryptedData = decrypt(fileData.data, password, fileData.salt);
        const parsedData = JSON.parse(decryptedData);
        return { success: true, data: parsedData || [] };
    } catch (error) {
        return { success: false, error: error.message, data: [] };
    }
});

ipcMain.handle('save-documents', async (event, { password, documents }) => {
    try {

        const MAX_FILE_SIZE = 100 * 1024 * 1024;
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
        await fs.writeFile(DOCUMENTS_FILE(), JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(DOCUMENTS_FILE());
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

function checkForUpdates() {
    if (!app.isPackaged) {
        console.log('Auto-update: Skipped (dev mode)');
        return;
    }

    try {
        const { autoUpdater } = require('electron-updater');

        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;

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

ipcMain.handle('install-update', async () => {
    try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.quitAndInstall();
    } catch (err) {
        console.error('Install update error:', err.message);
    }
});

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

let ipcServer;
const pendingExtensionRequests = new Map();
const PIPE_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\passsafer-ipc'
    : path.join(os.tmpdir(), 'passsafer-ipc.sock');

function startIpcServer(authToken) {

    if (process.platform !== 'win32') {
        try {
            require('fs').unlinkSync(PIPE_PATH);
        } catch (e) {}
    }

    ipcServer = net.createServer((socket) => {
        let dataBuffer = '';
        socket.on('data', (chunk) => {
            dataBuffer += chunk.toString();

            let newlineIdx;
            while ((newlineIdx = dataBuffer.indexOf('\n')) !== -1) {
                const message = dataBuffer.substring(0, newlineIdx).trim();
                dataBuffer = dataBuffer.substring(newlineIdx + 1);

                if (!message) continue;

                try {
                    const parsed = JSON.parse(message);

                    if (!parsed._token || parsed._token !== authToken) {
                        socket.write(JSON.stringify({ success: false, error: 'Unauthorized' }) + '\n');
                        socket.end();
                        return;
                    }
                    delete parsed._token;

                    if (global.touchIpcActivity) global.touchIpcActivity();

                    const requestId = crypto.randomUUID();

                    if (!mainWindow || mainWindow.isDestroyed()) {
                        socket.write(JSON.stringify({ success: false, error: 'App window not available' }) + '\n');
                        socket.end();
                        return;
                    }

                    const timeout = setTimeout(() => {
                        if (pendingExtensionRequests.has(requestId)) {
                            pendingExtensionRequests.delete(requestId);
                            if (parsed.action === 'save-credential') {
                                pendingExtensionCredentials.push(parsed);
                                if (socket && !socket.destroyed) {
                                    socket.write(JSON.stringify({ success: true, message: 'Saved to pending credentials' }) + '\n');
                                    socket.end();
                                }
                            } else {
                                if (socket && !socket.destroyed) {
                                    socket.write(JSON.stringify({ success: false, error: 'Timeout waiting for desktop app' }) + '\n');
                                    socket.end();
                                }
                            }
                        }
                    }, 5000);

                    pendingExtensionRequests.set(requestId, { socket, timeout, request: parsed });

                    mainWindow.webContents.send('native-request', { id: requestId, request: parsed });
                } catch (e) {
                    socket.write(JSON.stringify({ success: false, error: 'Invalid JSON' }) + '\n');
                    socket.end();
                }
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

ipcMain.on('native-response', (event, { id, response }) => {
    const pending = pendingExtensionRequests.get(id);
    if (pending) {
        clearTimeout(pending.timeout);
        pendingExtensionRequests.delete(id);

        if (pending.request && pending.request.action === 'save-credential' && response && response.error === 'Locked') {
            pendingExtensionCredentials.push(pending.request);
            response = { success: true, message: 'Saved to pending credentials' };
        }

        if (pending.socket && !pending.socket.destroyed) {
            pending.socket.write(JSON.stringify(response) + '\n');
            pending.socket.end();
        }
    }
});

ipcMain.handle('get-pending-extension-credentials', async () => {
    const creds = [...pendingExtensionCredentials];
    pendingExtensionCredentials = [];
    return creds;
});

ipcMain.handle('clear-master-password', async () => {
    inMemoryMasterPassword = null;
    return { success: true };
});

const dgram = require('dgram');
const tls = require('tls');

ipcMain.handle('sync-get-pairs', async () => {
    try {
        const data = await fs.readFile(SYNC_PAIRS_FILE, 'utf8');
        const pairs = JSON.parse(data);

        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const activePairs = pairs.filter(p => (Date.now() - p.lastSync) < thirtyDays);
        if (activePairs.length !== pairs.length) {
            await fs.writeFile(SYNC_PAIRS_FILE, JSON.stringify(activePairs, null, 2));
        }
        return { success: true, pairs: activePairs };
    } catch {
        return { success: true, pairs: [] };
    }
});

ipcMain.handle('sync-save-pair', async (event, { pair }) => {
    try {
        let pairs = [];
        try {
            pairs = JSON.parse(await fs.readFile(SYNC_PAIRS_FILE, 'utf8'));
        } catch {}
        const idx = pairs.findIndex(p => p.deviceId === pair.deviceId);
        if (idx >= 0) pairs[idx] = pair;
        else pairs.push(pair);
        await fs.writeFile(SYNC_PAIRS_FILE, JSON.stringify(pairs, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('sync-remove-pair', async (event, { deviceId }) => {
    try {
        let pairs = [];
        try {
            pairs = JSON.parse(await fs.readFile(SYNC_PAIRS_FILE, 'utf8'));
        } catch {}
        pairs = pairs.filter(p => p.deviceId !== deviceId);
        await fs.writeFile(SYNC_PAIRS_FILE, JSON.stringify(pairs, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

let autoSyncEnabled = false;
let autoSyncDiscoverySocket = null;
let autoSyncInterval = null;

ipcMain.handle('sync-enable-auto', async () => {
    if (autoSyncEnabled) return { success: true };
    if (!inMemoryMasterPassword || !currentUserDir) return { success: false, error: 'Not logged in' };

    autoSyncEnabled = true;

    autoSyncDiscoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    autoSyncDiscoverySocket.bind(41234, () => {
        autoSyncDiscoverySocket.setBroadcast(true);
        try { autoSyncDiscoverySocket.addMembership('224.0.0.251'); } catch(e) {}
    });

    autoSyncDiscoverySocket.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.service === '_passsafer-sync._tcp.local') {

                let pairs = [];
                try { pairs = JSON.parse(await fs.readFile(SYNC_PAIRS_FILE, 'utf8')); } catch {}
                const pair = pairs.find(p => p.deviceName === data.device);
                if (pair && inMemoryMasterPassword) {

                    pair.lastSync = Date.now();
                    await fs.writeFile(SYNC_PAIRS_FILE, JSON.stringify(pairs, null, 2));
                    updateSyncState('auto-syncing');
                }
            }
        } catch(e) {}
    });

    return { success: true };
});

ipcMain.handle('sync-disable-auto', async () => {
    autoSyncEnabled = false;
    if (autoSyncDiscoverySocket) {
        try { autoSyncDiscoverySocket.close(); } catch(e) {}
        autoSyncDiscoverySocket = null;
    }
    return { success: true };
});

async function discoverSyncServer(timeoutMs = 6000) {
    if (syncServer && syncPort > 0) {
        return { ip: '127.0.0.1', port: syncPort, device: os.hostname() };
    }
    return new Promise((resolve) => {
        let discSocket = null;
        let timer = null;
        let resolved = false;

        function cleanup() {
            if (timer) clearTimeout(timer);
            if (discSocket) {
                try { discSocket.close(); } catch(e){}
                discSocket = null;
            }
        }

        timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(null);
            }
        }, timeoutMs);

        try {
            discSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            discSocket.on('message', (msg, rinfo) => {
                try {
                    const data = JSON.parse(msg.toString());
                    if (data.service === '_passsafer-sync._tcp.local' && data.port) {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            resolve({ ip: rinfo.address, port: data.port, device: data.device || rinfo.address });
                        }
                    }
                } catch(e) {}
            });
            discSocket.on('error', () => {});
            discSocket.bind(41234, () => {
                discSocket.setBroadcast(true);
                try { discSocket.addMembership('224.0.0.251'); } catch(e){}
            });
        } catch(e) {
            cleanup();
            resolve(null);
        }
    });
}

ipcMain.handle('sync-connect', async (event, { ip, port, pin, direction }) => {
    let targetIp = ip;
    let targetPort = port;
    let targetDevice = null;

    if (!targetIp || !targetPort) {
        updateSyncState('connecting');
        const discovered = await discoverSyncServer(6000);
        if (!discovered) {
            updateSyncState('error');
            return { success: false, error: 'Kein PassSafer-Gerät im lokalen Netzwerk gefunden.' };
        }
        targetIp = discovered.ip;
        targetPort = discovered.port;
        targetDevice = discovered.device;
    }

    return new Promise((resolve) => {
        try {
            updateSyncState('connecting');
            const client = new net.Socket();
            let ecdh = crypto.createECDH('prime256v1');
            ecdh.generateKeys();
            let sharedSecret = null;
            let sessionPassword = null;
            let buffer = '';

            const timeout = setTimeout(() => {
                client.destroy();
                updateSyncState('error');
                resolve({ success: false, error: 'Verbindungstimeout' });
            }, 10000);

            client.connect(targetPort, targetIp, () => {

                client.write(JSON.stringify({
                    type: 'hello',
                    publicKey: ecdh.getPublicKey('hex')
                }) + '\n');
            });

            client.on('data', async (data) => {
                buffer += data.toString();
                if (!buffer.includes('\n')) return;

                const messages = buffer.split('\n');
                buffer = messages.pop();

                for (const msgStr of messages) {
                    if (!msgStr.trim()) continue;
                    try {
                        const msg = JSON.parse(msgStr);

                        if (msg.type === 'hello_reply') {
                            const serverKey = Buffer.from(msg.publicKey, 'hex');
                            sharedSecret = ecdh.computeSecret(serverKey);

                            client.write(JSON.stringify({
                                type: 'auth',
                                pin: pin
                            }) + '\n');

                        } else if (msg.type === 'auth_reply') {
                            if (!msg.success) {
                                clearTimeout(timeout);
                                client.destroy();
                                updateSyncState('error');
                                resolve({ success: false, error: 'Ungültige PIN' });
                                return;
                            }

                            const sessionKey = crypto.pbkdf2Sync(pin, 'PassSaferSync2024', 100000, 32, 'sha256');
                            sessionPassword = sessionKey.toString('hex');
                            sessionKey.fill(0);

                            updateSyncState('syncing');

                            let dataToSend = '{}';
                            if (direction === 'merge' || direction === 'push') {
                                const localData = await getAllLocalData();
                                dataToSend = JSON.stringify(localData);
                            }
                            const encryptedData = encryptExport(dataToSend, sessionPassword);

                            client.write(JSON.stringify({
                                type: 'sync_request',
                                direction: direction || 'merge',
                                data: encryptedData
                            }) + '\n');

                        } else if (msg.type === 'sync_reply') {
                            clearTimeout(timeout);
                            if (msg.success && msg.data) {
                                if (direction === 'merge' || direction === 'pull') {
                                    const decryptedStr = decryptExport(msg.data, sessionPassword);
                                    const serverData = JSON.parse(decryptedStr);
                                    await mergeAllFiles(serverData);
                                }
                            }
                            updateSyncState('complete');
                            client.destroy();
                            resolve({ success: true, deviceName: targetDevice });
                        }
                    } catch (err) {
                        clearTimeout(timeout);
                        client.destroy();
                        updateSyncState('error');
                        resolve({ success: false, error: err.message });
                    }
                }
            });

            client.on('error', (err) => {
                clearTimeout(timeout);
                updateSyncState('error');
                resolve({ success: false, error: err.message });
            });

            client.on('close', () => {
                clearTimeout(timeout);
            });
        } catch (err) {
            resolve({ success: false, error: err.message });
        }
    });
});

let syncState = 'idle';
let syncServer = null;
let syncUdpSocket = null;
let mDnsInterval = null;
let syncTimeout = null;
let syncPin = null;
let syncSharedSecret = null;
let syncAttempts = 0;
let syncPort = 0;

function updateSyncState(state) {
    syncState = state;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-status-update', state);
    }
}

function mergeArrays(local, remote) {
    const map = new Map();
    local.forEach(item => {
        if (item.id) map.set(item.id, item);
    });

    remote.forEach(item => {
        if (item.id) {
            const existing = map.get(item.id);
            if (!existing) {
                map.set(item.id, item);
            } else {
                const timeLocal = existing.updatedAt || 0;
                const timeRemote = item.updatedAt || 0;
                if (timeRemote > timeLocal) {
                    map.set(item.id, item);
                }
            }
        }
    });

    return Array.from(map.values());
}

async function getAllLocalDataForUser(userDir, masterPassword) {
    let result = {};
    try {
        const fileData = JSON.parse(await fs.readFile(path.join(userDir, '.pw'), 'utf8'));
        result.pw = JSON.parse(decrypt(fileData.data, masterPassword, fileData.salt));
    } catch(e){}
    try {
        const fileData = JSON.parse(await fs.readFile(path.join(userDir, '.id'), 'utf8'));
        result.id = JSON.parse(decrypt(fileData.data, masterPassword, fileData.salt));
    } catch(e){}
    try {
        const fileData = JSON.parse(await fs.readFile(path.join(userDir, '.doc'), 'utf8'));
        result.doc = JSON.parse(decrypt(fileData.data, masterPassword, fileData.salt));
    } catch(e){}
    try {
        const fileData = JSON.parse(await fs.readFile(path.join(userDir, '.card'), 'utf8'));
        result.card = JSON.parse(decrypt(fileData.data, masterPassword, fileData.salt));
    } catch(e){}
    try {
        const fileData = JSON.parse(await fs.readFile(path.join(userDir, '.report'), 'utf8'));
        result.report = JSON.parse(decrypt(fileData.data, masterPassword, fileData.salt));
    } catch(e){}
    return result;
}

async function getAllLocalData() {
    if (!inMemoryMasterPassword || !currentUserDir) return {};
    return getAllLocalDataForUser(currentUserDir, inMemoryMasterPassword);
}

async function mergeAllFiles(clientData, masterPass = inMemoryMasterPassword, userDir = currentUserDir) {
    if (!masterPass || !userDir) return;

    const pwFile = path.join(userDir, '.pw');
    const idFile = path.join(userDir, '.id');
    const docFile = path.join(userDir, '.doc');
    const cardFile = path.join(userDir, '.card');
    const reportFile = path.join(userDir, '.report');

    if (clientData.pw) {
        try {
            const fileData = JSON.parse(await fs.readFile(pwFile, 'utf8'));
            let localData = JSON.parse(decrypt(fileData.data, masterPass, fileData.salt));
            localData.passwords = mergeArrays(localData.passwords || [], clientData.pw.passwords || []);
            localData.folders = mergeArrays(localData.folders || [], clientData.pw.folders || []);
            localData.trash = mergeArrays(localData.trash || [], clientData.pw.trash || []);
            const newSalt = crypto.randomBytes(16).toString('hex');
            await fs.writeFile(pwFile, JSON.stringify({ salt: newSalt, data: encrypt(JSON.stringify(localData), masterPass, newSalt), kdf: 'scrypt' }));
        } catch(e){}
    }
    if (clientData.id) {
        try {
            const fileData = JSON.parse(await fs.readFile(idFile, 'utf8'));
            let localData = JSON.parse(decrypt(fileData.data, masterPass, fileData.salt));
            let merged = mergeArrays(localData, clientData.id);
            const newSalt = crypto.randomBytes(16).toString('hex');
            await fs.writeFile(idFile, JSON.stringify({ salt: newSalt, data: encrypt(JSON.stringify(merged), masterPass, newSalt), kdf: 'scrypt' }));
        } catch(e){}
    }
    if (clientData.doc) {
        try {
            const fileData = JSON.parse(await fs.readFile(docFile, 'utf8'));
            let localData = JSON.parse(decrypt(fileData.data, masterPass, fileData.salt));
            let merged = mergeArrays(localData, clientData.doc);
            const newSalt = crypto.randomBytes(16).toString('hex');
            await fs.writeFile(docFile, JSON.stringify({ salt: newSalt, data: encrypt(JSON.stringify(merged), masterPass, newSalt), kdf: 'scrypt' }));
        } catch(e){}
    }
    if (clientData.card) {
        try {
            const fileData = JSON.parse(await fs.readFile(cardFile, 'utf8'));
            let localData = JSON.parse(decrypt(fileData.data, masterPass, fileData.salt));
            let merged = mergeArrays(localData, clientData.card);
            const newSalt = crypto.randomBytes(16).toString('hex');
            await fs.writeFile(cardFile, JSON.stringify({ salt: newSalt, data: encrypt(JSON.stringify(merged), masterPass, newSalt), kdf: 'scrypt' }));
        } catch(e){}
    }
    if (clientData.report) {
        try {
            const fileData = JSON.parse(await fs.readFile(reportFile, 'utf8'));
            let localData = JSON.parse(decrypt(fileData.data, masterPass, fileData.salt));
            let merged = mergeArrays(localData, clientData.report);
            const newSalt = crypto.randomBytes(16).toString('hex');
            await fs.writeFile(reportFile, JSON.stringify({ salt: newSalt, data: encrypt(JSON.stringify(merged), masterPass, newSalt), kdf: 'scrypt' }));
        } catch(e){}
    }
}

function stopSyncServer() {
    if (mDnsInterval) clearInterval(mDnsInterval);
    if (syncTimeout) clearTimeout(syncTimeout);
    if (syncUdpSocket) {
        try { syncUdpSocket.close(); } catch(e){}
    }
    if (syncServer) {
        try { syncServer.close(); } catch(e){}
    }
    mDnsInterval = null;
    syncTimeout = null;
    syncUdpSocket = null;
    syncServer = null;
    syncPin = null;
    if (syncSharedSecret) {
        syncSharedSecret.fill(0);
        syncSharedSecret = null;
    }
    syncAttempts = 0;
    syncPort = 0;
    updateSyncState('idle');
}

ipcMain.handle('sync-start-server', async () => {
    if (syncState !== 'idle') return { success: false, error: 'Already running' };

    syncPin = crypto.randomInt(100000, 999999).toString();
    syncAttempts = 0;

    syncServer = net.createServer((socket) => {
        let ecdh = crypto.createECDH('prime256v1');
        ecdh.generateKeys();

        let buffer = '';
        socket.on('data', async (data) => {
            buffer += data.toString();
            if (!buffer.includes('\n')) return;

            const messages = buffer.split('\n');
            buffer = messages.pop();

            for (const msgStr of messages) {
                if (!msgStr.trim()) continue;
                try {
                    const msg = JSON.parse(msgStr);

                    if (msg.type === 'hello') {
                        updateSyncState('pairing');
                        const clientKey = Buffer.from(msg.publicKey, 'hex');
                        socket.sharedSecret = ecdh.computeSecret(clientKey);

                        socket.write(JSON.stringify({
                            type: 'hello_reply',
                            publicKey: ecdh.getPublicKey('hex')
                        }) + '\n');
                    } else if (msg.type === 'auth') {
                        if (msg.pin !== syncPin) {
                            socket.write(JSON.stringify({ type: 'auth_reply', success: false }) + '\n');
                            socket.destroy();
                            return;
                        }

                        const sessionKey = crypto.pbkdf2Sync(syncPin, 'PassSaferSync2024', 100000, 32, 'sha256');
                        socket.sharedSecret.fill(0);
                        socket.sessionPassword = sessionKey.toString('hex');
                        sessionKey.fill(0);

                        updateSyncState('syncing');
                        socket.write(JSON.stringify({ type: 'auth_reply', success: true }) + '\n');
                    } else if (msg.type === 'sync_request') {
                        if (!socket.sessionPassword) return;
                        const direction = msg.direction || 'merge';

                        if (msg.data) {
                            const decryptedStr = decryptExport(msg.data, socket.sessionPassword);
                            const clientData = JSON.parse(decryptedStr);
                            if (direction === 'merge' || direction === 'push') {
                                await mergeAllFiles(clientData);
                            }
                        }

                        if (direction === 'merge' || direction === 'pull') {
                            const localData = await getAllLocalData();
                            const serverEncrypted = encryptExport(JSON.stringify(localData), socket.sessionPassword);
                            socket.write(JSON.stringify({ type: 'sync_reply', success: true, data: serverEncrypted }) + '\n');
                        } else {
                            socket.write(JSON.stringify({ type: 'sync_reply', success: true, data: encryptExport('{}', socket.sessionPassword) }) + '\n');
                        }
                        updateSyncState('complete');
                        setTimeout(() => stopSyncServer(), 3000);
                    } else if (msg.type === 'sync') {
                        if (!socket.sessionPassword) return;
                        const decryptedStr = decryptExport(msg.data, socket.sessionPassword);
                        const clientData = JSON.parse(decryptedStr);

                        await mergeAllFiles(clientData);
                        const localData = await getAllLocalData();
                        const serverEncrypted = encryptExport(JSON.stringify(localData), socket.sessionPassword);

                        socket.write(JSON.stringify({ type: 'sync_reply', success: true, data: serverEncrypted }) + '\n');
                        updateSyncState('complete');
                        setTimeout(() => stopSyncServer(), 3000);
                    }
                } catch (err) {
                    updateSyncState('error');
                }
            }
        });
    });

    await new Promise((resolve) => {
        syncServer.listen(0, '0.0.0.0', () => {
            syncPort = syncServer.address().port;

            syncUdpSocket = dgram.createSocket('udp4');
            syncUdpSocket.bind(() => {
                syncUdpSocket.setBroadcast(true);
                syncUdpSocket.setMulticastTTL(128);
                syncUdpSocket.addMembership('224.0.0.251');

                mDnsInterval = setInterval(() => {
                    const payload = JSON.stringify({
                        service: '_passsafer-sync._tcp.local',
                        port: syncPort,
                        device: os.hostname()
                    });
                    try {
                        syncUdpSocket.send(payload, 0, payload.length, 5353, '224.0.0.251');
                        syncUdpSocket.send(payload, 0, payload.length, 41234, '255.255.255.255');
                    } catch(e){}
                }, 2000);
            });

            updateSyncState('waiting');

            syncTimeout = setTimeout(() => {
                stopSyncServer();
            }, 5 * 60 * 1000);

            resolve();
        });
    });

    let localIps = [];
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                localIps.push(alias.address);
            }
        }
    }
    const ipString = localIps.length > 0 ? localIps.join(', ') : '127.0.0.1';
    const primaryIp = localIps.length > 0 ? localIps[0] : '127.0.0.1';

    const qrPayload = `passsafer://sync?ip=${primaryIp}&port=${syncPort}&pin=${syncPin}`;
    let qrDataUrl = null;
    try {
        const QRCode = require('qrcode');
        qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 300, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
    } catch(e) {}

    return { success: true, pin: syncPin, port: syncPort, deviceName: os.hostname(), ip: ipString, qrDataUrl, qrPayload };
});

ipcMain.handle('sync-stop-server', async () => {
    stopSyncServer();
    return { success: true };
});

ipcMain.handle('sync-get-status', async () => {
    return { success: true, state: syncState };
});

app.on('will-quit', () => {
    stopSyncServer();
    if (ipcServer) {
        ipcServer.close();
    }
    inMemoryMasterPassword = null;
});

ipcMain.handle('password-audit', async (event, { password }) => {
    try {

        const fileData = JSON.parse(await fs.readFile(PASSWORDS_FILE(), 'utf8'));
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

        for (let idx = 0; idx < passwords.length; idx++) {
            const entry = passwords[idx];
            if (!entry.password) continue;

            const issues = [];
            const pwd = entry.password;

            if (pwd.length < 12) issues.push('weak_short');
            if (!/[A-Z]/.test(pwd)) issues.push('weak_no_upper');
            if (!/[a-z]/.test(pwd)) issues.push('weak_no_lower');
            if (!/[0-9]/.test(pwd)) issues.push('weak_no_digit');
            if (!/[^A-Za-z0-9]/.test(pwd)) issues.push('weak_no_special');

            const reusedCount = passwords.filter(p => p.password === pwd && p !== entry).length;
            if (reusedCount > 0) issues.push('reused');

            let strength = 0;
            if (pwd.length >= 8) strength += 20;
            if (pwd.length >= 12) strength += 15;
            if (pwd.length >= 16) strength += 10;
            if (/[A-Z]/.test(pwd)) strength += 10;
            if (/[a-z]/.test(pwd)) strength += 10;
            if (/[0-9]/.test(pwd)) strength += 10;
            if (/[^A-Za-z0-9]/.test(pwd)) strength += 15;

            const uniqueChars = new Set(pwd).size;
            if (uniqueChars >= 8) strength += 10;
            strength = Math.min(100, strength);

            results.push({
                originalIndex: idx,
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

ipcMain.handle('load-cards', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(CARDS_FILE(), 'utf8'));
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

ipcMain.handle('save-cards', async (event, { password, cards }) => {
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(JSON.stringify(cards), password, salt);
        await fs.writeFile(CARDS_FILE(), JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(CARDS_FILE());
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('load-reports', async (event, { password }) => {
    try {
        let fileData;
        try {
            fileData = JSON.parse(await fs.readFile(REPORTS_FILE(), 'utf8'));
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

ipcMain.handle('save-reports', async (event, { password, reports }) => {
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const encrypted = encrypt(JSON.stringify(reports), password, salt);
        await fs.writeFile(REPORTS_FILE(), JSON.stringify({ salt, data: encrypted, kdf: 'scrypt' }));
        await setSecurePermissions(REPORTS_FILE());
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
