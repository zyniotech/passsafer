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

    // License System
    activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
    importLicenseFile: () => ipcRenderer.invoke('import-license-file'),
    checkLicenseStatus: () => ipcRenderer.invoke('check-license-status'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    showLicenseInput: () => ipcRenderer.invoke('show-license-input'),

    // Auto-Update
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (e, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback())
});
