const { contextBridge, ipcRenderer } = require('electron');

// Expose geschützte IPC-Methoden an Renderer
contextBridge.exposeInMainWorld('api', {
    checkFirstRun: () => ipcRenderer.invoke('check-first-run'),
    register: (data) => ipcRenderer.invoke('register', data),
    login: (data) => ipcRenderer.invoke('login', data),
    loadPasswords: (data) => ipcRenderer.invoke('load-passwords', data),
    savePasswords: (data) => ipcRenderer.invoke('save-passwords', data),
    changePin: (data) => ipcRenderer.invoke('change-pin', data),
    changePassword: (data) => ipcRenderer.invoke('change-password', data),
    exportPasswords: (data) => ipcRenderer.invoke('export-passwords', data),
    importPasswords: (data) => ipcRenderer.invoke('import-passwords', data),
    deleteAccount: (data) => ipcRenderer.invoke('delete-account', data),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    writeFile: (data) => ipcRenderer.invoke('write-file', data),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

    // Utilities
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Auto-Update
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    manualCheckUpdates: () => ipcRenderer.invoke('manual-check-updates'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (e, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (e, info) => callback(info)),
    onUpdateError: (callback) => ipcRenderer.on('update-error', (e, message) => callback(message)),

    // Licensing
    getDeviceId: () => ipcRenderer.invoke('get-device-id'),
    loadLicense: () => ipcRenderer.invoke('load-license'),
    saveLicense: (data) => ipcRenderer.invoke('save-license', data),
    deleteLicense: () => ipcRenderer.invoke('delete-license'),

    // Native Messaging
    onNativeRequest: (callback) => ipcRenderer.on('native-request', (e, data) => callback(data)),
    sendNativeResponse: (data) => ipcRenderer.send('native-response', data),

    // Password Security Audit
    passwordAudit: (data) => ipcRenderer.invoke('password-audit', data),
    checkPwned: (data) => ipcRenderer.invoke('check-pwned', data)
});
