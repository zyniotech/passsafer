// Global State
let currentUser = null;
let currentPassword = null;
let passwords = [];
let folders = [];
let trash = [];
let ids = [];
let documents = [];
let cards = [];
let reports = [];
let currentActiveReport = null;
let currentFolder = null;
let currentEditIndex = null;
let currentEditFolder = null;
let currentFileData = null;
let currentFileName = null;
let currentFiles = []; // Array of {data, name}
let translations = {};
let currentLanguage = 'en';
const API_BASE_URL = 'https://passsafer-api.zyniotech.workers.dev';
let licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false, securityAudit: false } };

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Dark Mode is the default and only theme
    document.body.classList.remove('light-mode');
    localStorage.removeItem('app_theme');

    // Initialize Language
    const supportedLangs = ['en', 'de', 'es', 'fr'];
    const systemLang = navigator.language.split('-')[0];
    currentLanguage = supportedLangs.includes(systemLang) ? systemLang : 'en';
    await loadTranslations(currentLanguage);

    // Check license FIRST before showing any screen
    const hasLicense = await checkLicenseStatus().catch(err => {
        console.error('Startup license check failed:', err);
        return false;
    });

    if (!hasLicense) {
        // No valid license → show license screen first
        showScreen('license-screen');
    } else {
        // Valid license → proceed to login or register
        const isFirstRun = await window.api.checkFirstRun();
        if (isFirstRun) {
            showScreen('register-screen');
        } else {
            showScreen('login-screen');
        }
    }

    setupEventListeners();
    setupAutoLogout();
    setupCustomSelect();
    initializeCustomSelects();
    setupDashboardSearch();
    
    // Set language select value
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.value = currentLanguage;
        syncCustomSelect('language-select');
    }
});

// Screens where sidebar should be hidden (unauthenticated)
const SIDEBAR_HIDDEN_SCREENS = ['login-screen', 'register-screen', 'license-screen'];

// Map of nav items to screen IDs
const NAV_SCREEN_MAP = {
    'dashboard': 'dashboard-screen',
    'passwords': 'main-screen',
    'trash': 'trash-screen',
    'watchtower': 'audit-screen',
    'ids': 'ids-screen',
    'documents': 'documents-screen',
    'cards': 'cards-screen',
    'reports': 'reports-screen',
    'import': 'import-screen',
    'export': 'export-screen',
    'csv-import': 'csv-import-screen',
    'settings': 'settings-screen'
};

// Screen Management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        if (SIDEBAR_HIDDEN_SCREENS.includes(screenId)) {
            sidebar.classList.add('hidden');
        } else {
            sidebar.classList.remove('hidden');
        }
    }
}

// Toast Notifications
function showToast(message, type = 'info', isLiteral = false) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    
    const text = isLiteral ? message : (translations[message] || message);
    if (toastMessage) {
        toastMessage.textContent = text;
    } else {
        toast.textContent = text;
    }
    
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// i18n Logic
async function loadTranslations(lang) {
    try {
        const response = await fetch(`./locales/${lang}.json`);
        translations = await response.json();
        applyTranslations();
    } catch (err) {
        console.error('Failed to load translations:', err);
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        let translation = translations[key];
        
        if (translation) {
            if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'password' || el.type === 'url')) {
                el.placeholder = translation;
            } else if (el.hasAttribute('title')) {
                el.setAttribute('title', translation);
            } else {
                // Find span or text node to avoid overwriting icons
                const span = el.querySelector('span[data-i18n]') || (el.tagName === 'SPAN' ? el : null);
                if (span) {
                    span.textContent = translation;
                } else if (el.children.length === 0) {
                    el.textContent = translation;
                }
            }
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[key]) {
            el.placeholder = translations[key];
        }
    });

    if (typeof initializeCustomSelects === 'function') {
        initializeCustomSelects();
    }
}

function t(key, variables = {}) {
    let text = translations[key] || key;
    for (const [vKey, vValue] of Object.entries(variables)) {
        text = text.replace(`{${vKey}}`, vValue);
    }
    return text;
}

// Password Validation
function validatePassword(pwd) {
    if (pwd.length < 10) return false;
    if (!/[A-Z]/.test(pwd)) return false;
    if (!/[a-z]/.test(pwd)) return false;
    if (!/[0-9]/.test(pwd)) return false;
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) return false;
    return true;
}

function validateUsername(username) {
    if (username.length < 3 || username.length > 30) return false;
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) return false;
    if (username.startsWith('.') || username.endsWith('.')) return false;
    return true;
}

function generateStrongPassword() {
    if (!licenseState.valid || !licenseState.features || !licenseState.features.passwordGenerator) {
        showToast('msg_license_req_pwd_gen', 'warning');
        return;
    }
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const special = '!@#$%^&*()_+{}[]|:;<>,.?';
    const chars = upper + lower + digits + special;
    const length = 16;

    // [MITTEL-01] Cryptographically secure random index (rejection sampling, no modulo bias)
    function secureRandom(max) {
        const limit = Math.floor(0xFFFFFFFF / max) * max;
        let value;
        do {
            const array = new Uint32Array(1);
            crypto.getRandomValues(array);
            value = array[0];
        } while (value >= limit);
        return value % max;
    }

    let password = '';
    // Ensure at least one of each type
    password += upper[secureRandom(upper.length)];
    password += lower[secureRandom(lower.length)];
    password += digits[secureRandom(digits.length)];
    password += special[secureRandom(special.length)];

    for (let i = 4; i < length; i++) {
        password += chars[secureRandom(chars.length)];
    }

    // Fisher-Yates shuffle with CSPRNG
    const arr = password.split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = secureRandom(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    password = arr.join('');

    document.getElementById('edit-password').value = password;
}

// Helper for Enter key handling
function addEnterKeyListener(elementId, callback) {
    const el = document.getElementById(elementId);
    if (el) {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                callback();
            }
        });
    }
}

// Event Listeners Setup
function setupEventListeners() {
    // Login/Register
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('show-register-btn').addEventListener('click', () => showScreen('register-screen'));
    document.getElementById('show-login-btn').addEventListener('click', () => showScreen('login-screen'));

    // Enter key listeners on login & register
    addEnterKeyListener('login-username', handleLogin);
    addEnterKeyListener('login-password', handleLogin);
    addEnterKeyListener('login-pin', handleLogin);
    addEnterKeyListener('register-username', handleRegister);
    addEnterKeyListener('register-password', handleRegister);
    addEnterKeyListener('register-password-repeat', handleRegister);
    addEnterKeyListener('register-pin', handleRegister);
    addEnterKeyListener('license-key-input', handleActivateLicense);

    // Main Screen
    document.getElementById('add-password-btn').addEventListener('click', showAddPassword);
    document.getElementById('create-folder-btn').addEventListener('click', showCreateFolder);
    document.getElementById('back-btn').addEventListener('click', handleBackToRoot);
    document.getElementById('search-input').addEventListener('input', handleSearch);

    // Detail Screen
    document.getElementById('close-detail-btn').addEventListener('click', () => showMainScreen());
    document.getElementById('copy-username-btn').addEventListener('click', copyUsername);
    document.getElementById('copy-password-btn').addEventListener('click', copyPassword);
    const copyLinkBtn = document.getElementById('copy-link-btn');
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyLink);
    document.getElementById('toggle-password-btn').addEventListener('click', togglePasswordVisibility);
    document.getElementById('save-folder-btn').addEventListener('click', savePasswordFolder);
    document.getElementById('edit-password-btn').addEventListener('click', editCurrentPassword);
    
    // Link Opening in Default Browser
    const detailLink = document.getElementById('detail-link');
    if (detailLink) {
        detailLink.addEventListener('click', (e) => {
            e.preventDefault();
            const url = detailLink.textContent;
            if (url && url !== '#') {
                window.api.openExternal(url);
            }
        });
    }
    document.getElementById('delete-password-btn').addEventListener('click', deleteCurrentPassword);

    // Edit Password Screen
    document.getElementById('close-edit-btn').addEventListener('click', () => showMainScreen());
    document.getElementById('save-password-btn').addEventListener('click', handleSavePassword);
    document.getElementById('cancel-edit-btn').addEventListener('click', () => showMainScreen());
    document.getElementById('upload-file-btn').addEventListener('click', handleFileUpload);

    // Folder Screen
    document.getElementById('close-folder-btn').addEventListener('click', () => showMainScreen());
    document.getElementById('save-folder-btn-main').addEventListener('click', handleSaveFolder);
    document.getElementById('delete-folder-btn').addEventListener('click', handleDeleteFolder);
    document.getElementById('cancel-folder-btn').addEventListener('click', () => showMainScreen());

    // Settings Screen
    document.getElementById('close-settings-btn').addEventListener('click', () => showMainScreen());
    document.getElementById('change-pin-btn').addEventListener('click', () => showScreen('change-pin-screen'));
    document.getElementById('change-password-btn').addEventListener('click', () => showScreen('change-password-screen'));
    document.getElementById('generate-report-btn').addEventListener('click', generateManualReport);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('check-updates-btn').addEventListener('click', handleManualUpdateCheck);
    
    // License Listeners
    document.getElementById('activate-license-btn').addEventListener('click', handleActivateLicense);
    document.getElementById('get-trial-btn').addEventListener('click', () => {
        window.api.openExternal('https://zynio-tech.web.app/register');
    });
    document.getElementById('buy-premium-btn').addEventListener('click', () => {
        window.api.openExternal('https://zynio-tech.web.app/pricing');
    });
    // license-back-btn removed from HTML since license is now the first screen
    document.getElementById('settings-activate-license-btn').addEventListener('click', () => {
        const input = document.getElementById('license-key-input');
        if (input) {
            window.api.loadLicense().then(res => {
                if (res.success && res.license && res.license.licenseKey) {
                    input.value = res.license.licenseKey;
                }
            });
        }
        showScreen('license-screen');
    });

    document.getElementById('select-csv-file-btn').addEventListener('click', selectCsvFile);
    document.getElementById('do-csv-import-btn').addEventListener('click', handleCsvImport);

    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.addEventListener('change', async (e) => {
            currentLanguage = e.target.value;
            await loadTranslations(currentLanguage);
            showToast('msg_lang_changed', 'success');
        });
    }

    // Change PIN Screen
    document.getElementById('close-change-pin-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('save-new-pin-btn').addEventListener('click', handleChangePin);
    document.getElementById('cancel-change-pin-btn').addEventListener('click', () => showScreen('settings-screen'));
    addEnterKeyListener('current-pin', handleChangePin);
    addEnterKeyListener('new-pin', handleChangePin);
    addEnterKeyListener('repeat-pin', handleChangePin);

    // Change Password Screen
    document.getElementById('save-new-password-btn').addEventListener('click', handleChangePassword);
    document.getElementById('cancel-change-password-btn').addEventListener('click', () => showScreen('settings-screen'));
    addEnterKeyListener('current-password', handleChangePassword);
    addEnterKeyListener('new-password', handleChangePassword);
    addEnterKeyListener('repeat-password', handleChangePassword);

    // Generator
    const genBtn = document.getElementById('generate-password-btn');
    if (genBtn) {
        genBtn.addEventListener('click', generateStrongPassword);
    }

    // Export Screen
    document.getElementById('do-export-btn').addEventListener('click', handleExport);

    // Delete Account Screen
    document.getElementById('delete-account-btn').addEventListener('click', () => {
        document.getElementById('delete-account-password').value = '';
        showScreen('delete-account-screen');
    });
    document.getElementById('close-delete-account-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('cancel-delete-account-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('confirm-delete-account-btn').addEventListener('click', handleDeleteAccount);
    addEnterKeyListener('delete-account-password', handleDeleteAccount);

    // Import Screen
    document.getElementById('select-import-file-btn').addEventListener('click', selectImportFile);
    document.getElementById('do-import-btn').addEventListener('click', handleImport);

    // Modal Buttons
    // Modal Buttons
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    if (confirmBtn) {
        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        newConfirm.addEventListener('click', () => {
            if (pendingConfirmAction) pendingConfirmAction();
            hideConfirmationModal();
        });
    }

    if (cancelBtn) {
        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.addEventListener('click', hideConfirmationModal);
    }

    // Auto-Update Events
    setupAutoUpdate();

    // Setup new screens & features listeners
    setupNewEventListeners();
}

// Auto-Update Handler
function setupAutoUpdate() {
    if (window.api && window.api.onUpdateAvailable) {
        let downloadTimeout = null;

        function resetDownloadTimeout() {
            if (downloadTimeout) clearTimeout(downloadTimeout);
            downloadTimeout = setTimeout(() => {
                console.warn('Update download stalled. Triggering fallback.');
                showUpdateFallback('stalled');
            }, 60000); // 60 seconds timeout
        }

        function clearDownloadTimeout() {
            if (downloadTimeout) {
                clearTimeout(downloadTimeout);
                downloadTimeout = null;
            }
        }

        function showUpdateFallback(reason) {
            clearDownloadTimeout();
            const text = document.getElementById('update-text');
            const downloadBtn = document.getElementById('update-download-btn');
            const manualBtn = document.getElementById('update-manual-btn');
            const installBtn = document.getElementById('update-install-btn');

            text.textContent = t('msg_update_stalled');

            if (downloadBtn) downloadBtn.classList.add('hidden');
            if (installBtn) installBtn.classList.add('hidden');
            if (manualBtn) {
                manualBtn.classList.remove('hidden');
                manualBtn.textContent = t('btn_manual_download');
            }
        }

        window.api.onUpdateAvailable((info) => {
            clearDownloadTimeout();
            const banner = document.getElementById('update-banner');
            const text = document.getElementById('update-text');
            const downloadBtn = document.getElementById('update-download-btn');
            const installBtn = document.getElementById('update-install-btn');
            const manualBtn = document.getElementById('update-manual-btn');
            
            text.textContent = t('msg_new_version', { version: info.version }) || `Neue Version v${info.version} verfügbar!`;
            banner.classList.remove('hidden');
            if (downloadBtn) {
                downloadBtn.classList.remove('hidden');
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
            }
            if (installBtn) installBtn.classList.add('hidden');
            if (manualBtn) manualBtn.classList.add('hidden');
        });

        if (window.api.onUpdateProgress) {
            window.api.onUpdateProgress((info) => {
                resetDownloadTimeout();
                const text = document.getElementById('update-text');
                const downloadBtn = document.getElementById('update-download-btn');
                const manualBtn = document.getElementById('update-manual-btn');
                const percent = Math.round(info.percent || 0);
                text.textContent = t('msg_downloading', { percent });
                if (downloadBtn) {
                    downloadBtn.textContent = 'Downloading...';
                    downloadBtn.disabled = true;
                }
                if (manualBtn) manualBtn.classList.add('hidden');
            });
        }

        window.api.onUpdateDownloaded(() => {
            clearDownloadTimeout();
            const banner = document.getElementById('update-banner');
            const text = document.getElementById('update-text');
            const downloadBtn = document.getElementById('update-download-btn');
            const installBtn = document.getElementById('update-install-btn');
            const manualBtn = document.getElementById('update-manual-btn');
            
            text.textContent = t('msg_update_ready');
            banner.classList.remove('hidden');
            if (downloadBtn) downloadBtn.classList.add('hidden');
            if (installBtn) {
                installBtn.classList.remove('hidden');
                installBtn.textContent = t('msg_update_install');
            }
            if (manualBtn) manualBtn.classList.add('hidden');
            showToast(t('msg_update_toast_success'), 'success', true);
        });

        if (window.api.onUpdateError) {
            window.api.onUpdateError((errMessage) => {
                console.error('Update error received from main process:', errMessage);
                showUpdateFallback('error');
            });
        }

        document.getElementById('update-download-btn').addEventListener('click', async (e) => {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = 'Downloading...';
            resetDownloadTimeout();
            await window.api.downloadUpdate();
        });

        const manualBtn = document.getElementById('update-manual-btn');
        if (manualBtn) {
            manualBtn.addEventListener('click', () => {
                window.api.openExternal('https://zynio-tech.web.app/download');
            });
        }

        document.getElementById('update-install-btn').addEventListener('click', () => {
            window.api.installUpdate();
        });

        document.getElementById('update-dismiss-btn').addEventListener('click', () => {
            clearDownloadTimeout();
            document.getElementById('update-banner').classList.add('hidden');
        });
    }
}

// Login Handler
async function handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const pin = document.getElementById('login-pin').value;

    if (!username || !password || !pin) {
        showToast('msg_fill_all_fields', 'error');
        return;
    }

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
        showToast('msg_pin_format', 'error');
        return;
    }

    const result = await window.api.login({ username, password, pin });

    if (result.success) {
        currentUser = username;
        currentPassword = password;

        // License is already validated before login, so just load passwords
        const loadResult = await window.api.loadPasswords({ password });
        if (loadResult.success) {
            passwords = loadResult.data;
            folders = loadResult.folders;
            trash = loadResult.trash || [];
            
            // Load IDs and Documents
            const idsResult = await window.api.loadIds({ password });
            if (idsResult.success) ids = idsResult.data || [];
            const docsResult = await window.api.loadDocuments({ password });
            if (docsResult.success) documents = docsResult.data || [];
            const cardsResult = await window.api.loadCards({ password });
            if (cardsResult.success) cards = cardsResult.data || [];
            const reportsResult = await window.api.loadReports({ password });
            if (reportsResult.success) {
                reports = reportsResult.data || [];
                if (!localStorage.getItem('reports_cleaned_v2')) {
                    reports = [];
                    await window.api.saveReports({ password, reports });
                    localStorage.setItem('reports_cleaned_v2', 'true');
                }
            }
            // Purge expired items from trash on startup
            purgeExpiredTrash();

            showDashboard();
            showToast('msg_login_success', 'success');
            resetLogoutTimer();
            checkOnboarding();
        } else {
            showToast('msg_load_pwd_error', 'error');
        }
    } else {
        showToast('msg_invalid_credentials', 'error');
    }
}

// Register Handler
async function handleRegister() {
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const passwordRepeat = document.getElementById('register-password-repeat').value;
    const pin = document.getElementById('register-pin').value;

    if (!username || !password || !passwordRepeat || !pin) {
        showToast('msg_fill_all_fields', 'error');
        return;
    }

    if (!validateUsername(username)) {
        showToast('msg_username_format', 'error');
        return;
    }

    if (!validatePassword(password)) {
        showToast('msg_pwd_requirements', 'error');
        return;
    }

    if (password !== passwordRepeat) {
        showToast('msg_pwd_mismatch', 'error');
        return;
    }

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
        showToast('msg_pin_format', 'error');
        return;
    }

    const result = await window.api.register({ username, password, pin });

    if (result.success) {
        showToast('msg_account_created', 'success');
        showScreen('login-screen');
    } else {
        showToast('msg_reg_failed', 'error');
    }
}

// Main Screen
function showMainScreen() {
    currentEditIndex = null;
    currentEditFolder = null;
    // Clear sensitive data from DOM when leaving detail screen
    const pwdEl = document.getElementById('detail-password');
    if (pwdEl) {
        pwdEl.dataset.password = '';
        pwdEl.textContent = '';
    }
    showScreen('main-screen');
    updateHeaderTitle();
    updateControls();
    renderPasswordList();
    updateSidebarActive('passwords');
}

function updateHeaderTitle() {
    const title = document.getElementById('header-title');
    if (currentFolder) {
        const folder = folders.find(f => f.id === currentFolder);
        title.textContent = folder ? folder.name : 'Folder';
    } else {
        title.textContent = `Passwords - ${currentUser}`;
    }
}

function updateControls() {
    const mainControls = document.getElementById('main-controls');
    const backContainer = document.getElementById('back-container');

    if (currentFolder) {
        mainControls.style.display = 'none';
        backContainer.classList.remove('hidden');
    } else {
        mainControls.style.display = 'flex';
        backContainer.classList.add('hidden');
    }
}

function handleBackToRoot() {
    currentFolder = null;
    showMainScreen();
}

// Render Password List
function renderPasswordList() {
    const container = document.getElementById('password-list');
    container.innerHTML = '';

    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    // Filter folders and passwords based on search and current folder
    let displayFolders = [];
    let displayPasswords = [];

    if (!currentFolder) {
        // Root view - show folders
        displayFolders = searchTerm
            ? folders.filter(f => f.name.toLowerCase().includes(searchTerm))
            : folders;

        // Show passwords without folder
        displayPasswords = passwords.filter(p => !p.folderId);
    } else {
        // Folder view - show passwords in folder
        displayPasswords = passwords.filter(p => p.folderId === currentFolder);
    }

    // Apply search filter to passwords
    if (searchTerm && !currentFolder) {
        displayPasswords = displayPasswords.filter(p =>
            p.app.toLowerCase().includes(searchTerm) ||
            (p.username && p.username.toLowerCase().includes(searchTerm)) ||
            (p.notes && p.notes.toLowerCase().includes(searchTerm))
        );
    }

    // Show empty state if nothing to display
    if (displayFolders.length === 0 && displayPasswords.length === 0) {
        const message = searchTerm ? t('msg_no_results') : t('msg_no_passwords');
        container.innerHTML = `
            <div class="empty-state">
                <p>${message}</p>
                ${!searchTerm ? `<p class="hint">${t('msg_add_hint')}</p>` : ''}
            </div>
        `;
        return;
    }

    // Render folders
    displayFolders.forEach(folder => {
        const card = createFolderCard(folder);
        container.appendChild(card);
    });

    // Render passwords
    displayPasswords.forEach((pwd, index) => {
        const actualIndex = passwords.indexOf(pwd);
        const card = createPasswordCard(pwd, actualIndex);
        container.appendChild(card);
    });
}

function isLocalNetwork(domain) {
    if (!domain) return false;
    const d = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].split(':')[0];
    if (d === 'localhost' || d.endsWith('.local') || d.endsWith('.lan') || d.endsWith('.home') || d.endsWith('.internal')) return true;
    if (/^(?:127|10|192\.168|172\.(?:1[6-9]|2[0-9]|3[0-1]))\./.test(d)) return true;
    return false;
}

function getFaviconUrl(domain) {
    if (!domain) return null;
    let d = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
    if (!d) return null;
    if (isLocalNetwork(d)) {
        return null;
    }
    if (!d.includes('.')) return null;
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=64';
}

function createPasswordCard(pwd, index) {
    const card = document.createElement('div');
    card.className = 'password-card';
    card.setAttribute('draggable', 'true');

    const domain = pwd.domain || pwd.url || pwd.link || '';
    const faviconUrl = getFaviconUrl(domain);
    const firstLetter = (pwd.app || '?').charAt(0).toUpperCase();
    const isLocal = isLocalNetwork(domain);
    const cardIconId = 'pwd-icon-' + (pwd.id || index);

    let iconHtml = '';
    if (faviconUrl) {
        iconHtml = `
            <div class="password-card-icon" data-icon-id="${cardIconId}">
                <img src="${faviconUrl}" alt="${firstLetter}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=&quot;password-card-icon-letter&quot;>${firstLetter}</span>';">
            </div>
        `;
    } else {
        iconHtml = `
            <div class="password-card-icon" data-icon-id="${cardIconId}">
                <span class="password-card-icon-letter">${firstLetter}</span>
            </div>
        `;
    }

    card.innerHTML = `
        <div style="display: flex; align-items: center;">
            ${iconHtml}
            <span class="password-card-name">${escapeHtml(pwd.app)}</span>
        </div>
        <span class="password-card-arrow">
            <img src="../logos/right.png" alt=">">
        </span>
    `;

    if (!faviconUrl && isLocal && window.api && window.api.fetchLocalFavicon) {
        window.api.fetchLocalFavicon(domain).then(localDataUrl => {
            if (localDataUrl) {
                const container = card.querySelector(`[data-icon-id="${cardIconId}"]`);
                if (container) {
                    container.innerHTML = `<img src="${localDataUrl}" alt="${firstLetter}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=&quot;password-card-icon-letter&quot;>${firstLetter}</span>';">`;
                }
            }
        }).catch(() => {});
    }

    card.addEventListener('click', () => showPasswordDetail(index));
    card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', index.toString());
    });
    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
    });
    return card;
}

function createFolderCard(folder) {
    const passwordCount = passwords.filter(p => p.folderId === folder.id).length;
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.setAttribute('data-drop-target', 'true');
    card.innerHTML = `
        <img src="../logos/folder.png" alt="Folder" class="folder-card-icon">
        <span class="folder-card-name">${escapeHtml(folder.name)}</span>
        <span class="folder-card-count">${passwordCount}</span>
        <button class="folder-card-edit" title="${t('btn_edit')}">
            <img src="../logos/pencil.png" alt="Edit">
        </button>
    `;

    card.addEventListener('click', (e) => {
        if (e.target.closest('.folder-card-edit')) {
            e.stopPropagation();
            showEditFolder(folder);
        } else {
            openFolder(folder.id);
        }
    });

    card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
    });

    card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const passwordIndex = parseInt(e.dataTransfer.getData('text/plain'));
        if (!isNaN(passwordIndex) && passwords[passwordIndex]) {
            const pwd = passwords[passwordIndex];
            pwd.folderId = folder.id;
            const result = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
            if (result.success) {
                showToast(t('msg_moved_to_folder', { app: pwd.app, folder: folder.name }), 'success', true);
                renderPasswordList();
            } else {
                showToast('msg_error', 'error');
            }
        }
    });

    return card;
}

function openFolder(folderId) {
    currentFolder = folderId;
    showMainScreen();
}

function handleSearch() {
    renderPasswordList();
}

// Password Detail Screen
function showPasswordDetail(index) {
    currentEditIndex = index;
    const pwd = passwords[index];

    document.getElementById('detail-title').textContent = pwd.app;
    document.getElementById('detail-app').textContent = pwd.app;
    document.getElementById('detail-username').textContent = pwd.username || '';
    document.getElementById('detail-password').textContent = pwd.password ? '•'.repeat(pwd.password.length) : '';
    document.getElementById('detail-password').dataset.password = pwd.password || '';
    document.getElementById('detail-password').dataset.masked = 'true';

    const linkSection = document.getElementById('link-section');
    if (pwd.link) {
        document.getElementById('detail-link').href = pwd.link.startsWith('http') ? pwd.link : 'https://' + pwd.link;
        document.getElementById('detail-link').textContent = pwd.link;
        if (linkSection) linkSection.style.display = 'block';
    } else {
        if (linkSection) linkSection.style.display = 'none';
    }

    const notesSection = document.getElementById('notes-section');
    if (pwd.notes) {
        document.getElementById('detail-notes').textContent = pwd.notes;
        notesSection.style.display = 'block';
    } else {
        notesSection.style.display = 'none';
    }

    // File section
    const fileSection = document.getElementById('file-section');
    const files = pwd.files || (pwd.fileName && pwd.fileData ? [{ data: pwd.fileData, name: pwd.fileName }] : []);
    if (files.length > 0) {
        renderDetailFileList(files);
        fileSection.style.display = 'block';
    } else {
        fileSection.style.display = 'none';
    }

    // Populate custom dropdown
    const optionsContainer = document.getElementById('custom-folder-options');
    const trigger = document.getElementById('custom-folder-trigger');
    const hiddenInput = document.getElementById('folder-select');

    optionsContainer.innerHTML = '';

    // Add "No Folder" option
    const noFolderOption = document.createElement('div');
    noFolderOption.textContent = t('label_no_folder');
    noFolderOption.addEventListener('click', () => {
        trigger.textContent = t('label_no_folder');
        hiddenInput.value = '';
        optionsContainer.classList.add('select-hide');
    });
    optionsContainer.appendChild(noFolderOption);

    let foundCurrent = false;
    folders.forEach(folder => {
        const option = document.createElement('div');
        option.textContent = folder.name;
        
        if (pwd.folderId === folder.id) {
            trigger.textContent = folder.name;
            hiddenInput.value = folder.id;
            foundCurrent = true;
        }

        option.addEventListener('click', () => {
            trigger.textContent = folder.name;
            hiddenInput.value = folder.id;
            closeAllSelect(null);
        });

        optionsContainer.appendChild(option);
    });

    if (!foundCurrent) {
        trigger.textContent = t('label_no_folder');
        hiddenInput.value = '';
    }

    showScreen('detail-screen');
}

// Custom Select Logic
function setupCustomSelect() {
    const trigger = document.getElementById('custom-folder-trigger');
    if (trigger) {
        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            closeAllSelect(this);
            document.getElementById('custom-folder-options').classList.toggle('select-hide');
            this.classList.toggle('select-arrow-active');
        });
    }

    document.addEventListener('click', closeAllSelect);
}

function closeAllSelect(elmnt) {
    const x = document.getElementsByClassName("select-items");
    const y = document.getElementsByClassName("select-selected");

    for (let i = 0; i < y.length; i++) {
        if (elmnt == y[i]) {
            continue;
        }
        y[i].classList.remove("select-arrow-active");
    }

    for (let i = 0; i < x.length; i++) {
        x[i].classList.add("select-hide");
    }
}

function togglePasswordVisibility() {
    const pwdElement = document.getElementById('detail-password');
    const isMasked = pwdElement.dataset.masked === 'true';

    if (isMasked) {
        pwdElement.textContent = pwdElement.dataset.password;
        pwdElement.dataset.masked = 'false';
    } else {
        pwdElement.textContent = '•'.repeat(pwdElement.dataset.password.length);
        pwdElement.dataset.masked = 'true';
    }
}

// Auto-clear clipboard after timeout
let clipboardClearTimer = null;
async function scheduleClipboardClear() {
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    clipboardClearTimer = setTimeout(async () => {
        try {
            await window.api.clearClipboard();
        } catch (e) {
            console.error('Failed to clear clipboard:', e);
        }
    }, 30000); // 30 seconds
}

async function copyUsername() {
    const username = document.getElementById('detail-username').textContent;
    try {
        await window.api.copyToClipboard(username);
        showToast('msg_copied', 'success');
        await scheduleClipboardClear();
    } catch (e) {
        showToast('msg_copy_failed', 'error');
    }
}

async function copyLink() {
    const link = document.getElementById('detail-link').textContent;
    try {
        await window.api.copyToClipboard(link);
        showToast('msg_copied', 'success');
        await scheduleClipboardClear();
    } catch (e) {
        showToast('msg_copy_failed', 'error');
    }
}

async function copyPassword() {
    const pwdElement = document.getElementById('detail-password');
    const password = pwdElement.dataset.password;
    try {
        await window.api.copyToClipboard(password);
        showToast('msg_copied', 'success');
        await scheduleClipboardClear();
    } catch (e) {
        showToast('msg_copy_failed', 'error');
    }
}

async function savePasswordFolder() {
    const folderId = document.getElementById('folder-select').value || null;
    passwords[currentEditIndex].folderId = folderId;

    const result = await window.api.savePasswords({
        password: currentPassword,
        passwords,
        folders,
        trash
    });

    if (result.success) {
        showToast('msg_folder_assignment_saved', 'success');
    } else {
        showToast('msg_save_error', 'error');
    }
}

function editCurrentPassword() {
    showEditPassword(currentEditIndex);
}

async function deleteCurrentPassword() {
    showConfirmationModal(
        'modal_delete_pwd_title',
        'modal_delete_pwd_desc',
        async () => {
            await moveToTrash(currentEditIndex);
        }
    );
}

// Add/Edit Password
function showAddPassword() {
    currentEditIndex = null;
    currentFileData = null;
    currentFileName = null;
    currentFiles = [];
    document.getElementById('edit-title').textContent = 'Add Password';
    document.getElementById('edit-app').value = '';
    const editLink = document.getElementById('edit-link');
    if (editLink) editLink.value = '';
    document.getElementById('edit-username').value = '';
    document.getElementById('edit-password').value = '';
    document.getElementById('edit-notes').value = '';
    renderEditFileList();
    showScreen('edit-password-screen');
}

function showEditPassword(index) {
    currentEditIndex = index;
    const pwd = passwords[index];

    // Migrate old single-file format to new array format
    currentFiles = pwd.files || (pwd.fileName && pwd.fileData ? [{ data: pwd.fileData, name: pwd.fileName }] : []);
    currentFileData = null;
    currentFileName = null;

    document.getElementById('edit-title').textContent = 'Edit Password';
    document.getElementById('edit-app').value = pwd.app;
    const editLink = document.getElementById('edit-link');
    if (editLink) editLink.value = pwd.link || '';
    document.getElementById('edit-username').value = pwd.username || '';
    document.getElementById('edit-password').value = pwd.password || '';
    document.getElementById('edit-notes').value = pwd.notes || '';
    renderEditFileList();
    showScreen('edit-password-screen');
}

async function handleSavePassword() {
    const app = document.getElementById('edit-app').value;
    const linkInput = document.getElementById('edit-link');
    const link = linkInput ? linkInput.value : '';
    const username = document.getElementById('edit-username').value;
    const password = document.getElementById('edit-password').value;
    const notes = document.getElementById('edit-notes').value;

    if (!app) {
        showToast('msg_app_name_required', 'error');
        return;
    }

    const passwordData = {
        app,
        link,
        username,
        password,
        notes,
        folderId: currentFolder,
        files: currentFiles
    };

    if (currentEditIndex !== null) {
        // Edit existing
        passwords[currentEditIndex] = { ...passwords[currentEditIndex], ...passwordData };
    } else {
        // Add new
        passwords.push(passwordData);
    }

    const result = await window.api.savePasswords({
        password: currentPassword,
        passwords,
        folders,
        trash
    });

    if (result.success) {
        showToast('msg_saved', 'success');
        showMainScreen();
    } else {
        showToast('msg_save_error', 'error');
    }
}

// Folder Management
function showCreateFolder() {
    currentEditFolder = null;
    document.getElementById('folder-title').textContent = 'Create Folder';
    document.getElementById('folder-name').value = '';
    document.getElementById('delete-folder-btn').classList.add('hidden');
    showScreen('folder-screen');
}

function showEditFolder(folder) {
    currentEditFolder = folder;
    document.getElementById('folder-title').textContent = 'Edit Folder';
    document.getElementById('folder-name').value = folder.name;
    document.getElementById('delete-folder-btn').classList.remove('hidden');
    showScreen('folder-screen');
}

async function handleSaveFolder() {
    const name = document.getElementById('folder-name').value.trim();

    if (!name) {
        showToast('msg_folder_name_required', 'error');
        return;
    }

    // Check for duplicate name
    if (folders.some(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== currentEditFolder?.id)) {
        showToast('msg_folder_exists', 'error');
        return;
    }

    if (currentEditFolder) {
        // Edit
        currentEditFolder.name = name;
    } else {
        // Create
        const newFolder = {
            id: generateId(),
            name
        };
        folders.push(newFolder);
    }

    const result = await window.api.savePasswords({
        password: currentPassword,
        passwords,
        folders,
        trash
    });

    if (result.success) {
        showToast('msg_folder_saved', 'success');
        showMainScreen();
    } else {
        showToast('msg_save_error', 'error');
    }
}

async function handleDeleteFolder() {
    showConfirmationModal(
        'modal_delete_folder_title',
        'modal_delete_folder_desc',
        async () => {
            // Move passwords to root
            passwords.forEach(pwd => {
                if (pwd.folderId === currentEditFolder.id) {
                    pwd.folderId = null;
                }
            });

            // Delete folder
            folders = folders.filter(f => f.id !== currentEditFolder.id);

            const result = await window.api.savePasswords({
                password: currentPassword,
                passwords,
                folders,
                trash
            });

            if (result.success) {
                showToast('msg_folder_deleted', 'success');
                showMainScreen();
            } else {
                showToast('msg_delete_error', 'error');
            }
        }
    );
}

// Change PIN
async function handleChangePin() {
    const masterPwd = document.getElementById('confirm-master-pwd-pin').value;
    const currentPin = document.getElementById('confirm-current-pin').value;
    const newPin = document.getElementById('new-pin').value;
    const newPinRepeat = document.getElementById('new-pin-repeat').value;

    if (!masterPwd || !currentPin || !newPin || !newPinRepeat) {
        showToast('msg_fill_all_fields', 'error');
        return;
    }

    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
        showToast('msg_pin_format', 'error');
        return;
    }

    if (newPin !== newPinRepeat) {
        showToast('msg_pin_mismatch', 'error');
        return;
    }

    const result = await window.api.changePin({
        currentPassword: masterPwd,
        currentPin,
        newPin
    });

    if (result.success) {
        showToast('msg_pin_changed', 'success');
        // Clear fields
        document.getElementById('confirm-master-pwd-pin').value = '';
        document.getElementById('confirm-current-pin').value = '';
        document.getElementById('new-pin').value = '';
        document.getElementById('new-pin-repeat').value = '';
        setTimeout(() => showScreen('settings-screen'), 1500);
    } else {
        showToast('Error: ' + (result.error || 'Invalid inputs!'), 'error');
    }
}

// Change Master Password
async function handleChangePassword() {
    const currentPwd = document.getElementById('confirm-current-pwd').value;
    const pin = document.getElementById('confirm-pin-pwd').value;
    const newPwd = document.getElementById('new-master-pwd').value;
    const newPwdRepeat = document.getElementById('new-master-pwd-repeat').value;

    if (!currentPwd || !pin || !newPwd || !newPwdRepeat) {
        showToast('msg_fill_all_fields', 'error');
        return;
    }

    if (!validatePassword(newPwd)) {
        showToast('msg_pwd_requirements', 'error');
        return;
    }

    if (newPwd !== newPwdRepeat) {
        showToast('msg_pwd_mismatch', 'error');
        return;
    }

    const result = await window.api.changePassword({
        currentPassword: currentPwd,
        currentPin: pin,
        newPassword: newPwd
    });

    if (result.success) {
        currentPassword = newPwd;
        showToast('msg_pwd_changed', 'success');
        // Clear fields
        document.getElementById('confirm-current-pwd').value = '';
        document.getElementById('confirm-pin-pwd').value = '';
        document.getElementById('new-master-pwd').value = '';
        document.getElementById('new-master-pwd-repeat').value = '';
        setTimeout(() => showScreen('settings-screen'), 1500);
    } else {
        showToast('Error: ' + (result.error || 'Invalid inputs!'), 'error');
    }
}

// [HOCH-03] Delete Account - jetzt mit PIN-Verifikation
async function handleDeleteAccount() {
    const password = document.getElementById('delete-account-password').value;
    const pin = document.getElementById('delete-account-pin').value;

    if (!password || !pin) {
        showToast('msg_enter_pwd_pin', 'error');
        return;
    }

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
        showToast('msg_pin_format', 'error');
        return;
    }

    const result = await window.api.deleteAccount({ password, pin });

    if (result.success) {
        showToast('msg_account_deleted', 'success');
        setTimeout(() => {
            // Force reload to reset state and show register screen
            location.reload();
        }, 2000);
    } else {
        showToast('Error: ' + (result.error || 'Deletion failed'), 'error');
    }
}

// Logout
function handleLogout(force = false) {
    if (force) {
        performLogout();
        return;
    }

    showConfirmationModal(
        'modal_logout_title',
        'modal_logout_desc',
        performLogout
    );
}

function performLogout() {
    currentUser = null;
    currentPassword = null;
    passwords = [];
    folders = [];
    trash = [];
    ids = [];
    documents = [];
    cards = [];
    reports = [];
    currentActiveReport = null;
    currentFolder = null;

    if (clipboardClearTimer) {
        clearTimeout(clipboardClearTimer);
        clipboardClearTimer = null;
    }

    // Clear input fields
    const loginPwd = document.getElementById('login-password');
    if (loginPwd) loginPwd.value = '';
    const loginPin = document.getElementById('login-pin');
    if (loginPin) loginPin.value = '';

    showToast('msg_logout_success', 'success');
    setTimeout(() => showScreen('login-screen'), 1000);
}

// Custom Confirmation Modal
let pendingConfirmAction = null;

function showConfirmationModal(titleKey, descKey, onConfirm) {
    document.getElementById('modal-title').textContent = t(titleKey);
    document.getElementById('modal-desc').textContent = t(descKey);
    pendingConfirmAction = onConfirm;

    // Also translate buttons
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    if (confirmBtn) confirmBtn.textContent = t('modal_confirm');
    if (cancelBtn) cancelBtn.textContent = t('modal_cancel');

    document.getElementById('confirmation-modal').classList.add('show');
}

function hideConfirmationModal() {
    const modal = document.getElementById('confirmation-modal');
    if (modal) modal.classList.remove('show');
    pendingConfirmAction = null;
}

// Auto Logout
let logoutTimer;
const LOGOUT_TIMEOUT = 10 * 60 * 1000; // 10 Minuten

function setupAutoLogout() {
    ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, resetLogoutTimer);
    });
}

function resetLogoutTimer() {
    if (!currentUser) return; // Nur wenn eingeloggt

    clearTimeout(logoutTimer);
    logoutTimer = setTimeout(() => {
        if (currentUser) {
            showToast('msg_inactivity_logout', 'info');
            handleLogout(true);
        }
    }, LOGOUT_TIMEOUT);
}

// Export Handler
async function handleExport() {
    const exportPassword = document.getElementById('export-password').value;
    if (!exportPassword) {
        showToast('msg_export_pwd_required', 'error');
        return;
    }

    // [MITTEL-03] Export-Passwort muss gleiche Anforderungen erfüllen
    if (!validatePassword(exportPassword)) {
        showToast('msg_export_pwd_format', 'error');
        return;
    }

    const { filePath } = await window.api.showSaveDialog({
        title: 'Export Passwords',
        defaultPath: `passsafer_backup_${currentUser}.pass`,
        filters: [{ name: 'PassSafer Files', extensions: ['pass'] }]
    });

    if (filePath) {
        // Prepare data for export
        const exportData = {
            passwords,
            folders,
            ids,
            documents,
            cards
        };

        const result = await window.api.exportPasswords({
            password: exportPassword,
            filePath,
            data: exportData
        });

        if (result.success) {
            showToast('msg_export_success', 'success');
            showScreen('settings-screen');
        } else {
            showToast(result.error ? ('Export: ' + result.error) : 'msg_export_error', 'error', true);
        }
    }
}

// Import Handler
async function selectImportFile() {
    const { filePaths } = await window.api.showOpenDialog({
        title: 'Import Password File',
        filters: [{ name: 'PassSafer Files', extensions: ['pass'] }],
        properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
        const path = filePaths[0];
        document.getElementById('import-file-path').textContent = path;
        document.getElementById('import-file-path').dataset.path = path;
    }
}

async function handleImport() {
    const filePath = document.getElementById('import-file-path').dataset.path;
    const importPassword = document.getElementById('import-password').value;

    if (!filePath) {
        showToast('msg_select_file', 'error');
        return;
    }

    if (!importPassword) {
        showToast('msg_import_pwd_required', 'error');
        return;
    }

    const result = await window.api.importPasswords({
        password: importPassword,
        filePath
    });

    if (result.success) {
        const importedData = result.data;
        let addedCount = 0;

        // 1. Handle Folders
        const importedFolders = importedData.folders || [];
        const folderIdMap = new Map(); // Old ID -> New/Existing ID

        importedFolders.forEach(impFolder => {
            // Check if folder with same name exists
            const existingFolder = folders.find(f => f.name === impFolder.name);

            if (existingFolder) {
                // Map to existing folder
                folderIdMap.set(impFolder.id, existingFolder.id);
            } else {
                // Create new folder
                const newId = generateId();
                folders.push({
                    id: newId,
                    name: impFolder.name,
                    created: Date.now()
                });
                folderIdMap.set(impFolder.id, newId);
            }
        });

        // 2. Handle Passwords and Map to Folders
        const importedPasswords = importedData.passwords || importedData.data || [];

        importedPasswords.forEach(impPwd => {
            // Simple duplicate check (app name only as requested)
            const exists = passwords.some(p => p.app === impPwd.app);

            if (!exists) {
                // Map folder ID if it exists
                if (impPwd.folderId && folderIdMap.has(impPwd.folderId)) {
                    impPwd.folderId = folderIdMap.get(impPwd.folderId);
                } else {
                    impPwd.folderId = null; // Reset if folder not found or not in map
                }

                passwords.push(impPwd);
                addedCount++;
            }
        });

        // 3. Handle IDs
        const importedIds = importedData.ids || [];
        let addedIdsCount = 0;
        importedIds.forEach(impId => {
            const exists = ids.some(item => item.name === impId.name);
            if (!exists) {
                ids.push(impId);
                addedIdsCount++;
            }
        });

        // 4. Handle Documents
        const importedDocs = importedData.documents || [];
        let addedDocsCount = 0;
        importedDocs.forEach(impDoc => {
            const exists = documents.some(item => item.name === impDoc.name);
            if (!exists) {
                documents.push(impDoc);
                addedDocsCount++;
            }
        });

        // 5. Handle Cards
        const importedCards = importedData.cards || [];
        let addedCardsCount = 0;
        importedCards.forEach(impCard => {
            const exists = cards.some(item => item.name === impCard.name);
            if (!exists) {
                cards.push(impCard);
                addedCardsCount++;
            }
        });

        // Save merged data
        const saveResult = await window.api.savePasswords({
            password: currentPassword,
            passwords,
            folders,
            trash // Fix Bug A: pass trash parameter
        });
        const saveIdsResult = await window.api.saveIds({ password: currentPassword, ids });
        const saveDocsResult = await window.api.saveDocuments({ password: currentPassword, documents });
        const saveCardsResult = await window.api.saveCards({ password: currentPassword, cards });

        if (saveResult.success && saveIdsResult.success && saveDocsResult.success && saveCardsResult.success) {
            showToast(`${addedCount} passwords, ${addedIdsCount} IDs, ${addedDocsCount} documents, and ${addedCardsCount} cards imported successfully!`, 'success');
            renderPasswordList();
            showScreen('settings-screen');
        } else {
            showToast('Error saving imported data!', 'error');
        }
    } else {
        showToast(result.error, 'error');
    }
}

// File Upload Handler
async function handleFileUpload() {
    if (currentFiles.length >= 5) {
        showToast('msg_max_files', 'error');
        return;
    }

    const { filePaths } = await window.api.showOpenDialog({
        title: 'Select File to Attach',
        properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
        const filePath = filePaths[0];
        const result = await window.api.readFile(filePath);

        if (result.success) {
            currentFiles.push({ data: result.data, name: result.fileName });
            renderEditFileList();
            showToast('msg_file_attached', 'success');
        } else {
            showToast(result.error || 'msg_file_read_error', 'error');
        }
    }
}

// Render file list in Edit form
function renderEditFileList() {
    const container = document.getElementById('edit-file-list');
    const hint = document.getElementById('edit-file-hint');
    container.innerHTML = '';

    if (currentFiles.length === 0) {
        hint.textContent = 'No files selected';
        hint.style.display = '';
        return;
    }

    hint.style.display = 'none';

    currentFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-list-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-item-name';
        nameSpan.textContent = file.name;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'file-delete-btn';
        deleteBtn.type = 'button';
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Remove file';
        deleteBtn.addEventListener('click', () => {
            currentFiles.splice(index, 1);
            renderEditFileList();
        });

        item.appendChild(nameSpan);
        item.appendChild(deleteBtn);
        container.appendChild(item);
    });
}

// Render file list in Detail view
function renderDetailFileList(files) {
    const container = document.getElementById('detail-file-list');
    container.innerHTML = '';

    files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-list-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-item-name';
        nameSpan.textContent = file.name;

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'file-download-btn';
        downloadBtn.title = 'Download';
        downloadBtn.innerHTML = '<img src="../logos/download.png" alt="Download">';
        downloadBtn.addEventListener('click', () => handleFileDownloadByIndex(index));

        item.appendChild(nameSpan);
        item.appendChild(downloadBtn);
        container.appendChild(item);
    });
}

// File Download Handler (per file)
async function handleFileDownloadByIndex(fileIndex) {
    const pwd = passwords[currentEditIndex];
    const files = pwd.files || (pwd.fileName && pwd.fileData ? [{ data: pwd.fileData, name: pwd.fileName }] : []);
    const file = files[fileIndex];

    if (!file) {
        showToast('msg_file_not_found', 'error');
        return;
    }

    const { filePath } = await window.api.showSaveDialog({
        title: 'Save Attached File',
        defaultPath: file.name
    });

    if (filePath) {
        const result = await window.api.writeFile({
            filePath,
            data: file.data
        });

        if (result.success) {
            showToast('msg_file_saved', 'success');
        } else {
            showToast('msg_file_save_error', 'error');
        }
    }
}

// [MITTEL-02] Utility Functions - kryptographisch sichere ID-Generierung
function generateId() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Settings Screen Helper
function showSettings() {
    updateSettingsLicenseUI();
    checkLicenseStatus(true).catch(err => console.error('Silent license sync failed:', err));
    showScreen('settings-screen');
    updateSidebarActive('settings');
}

// Manual Update Check
async function handleManualUpdateCheck() {
    showToast('settings_updates', 'info'); // Using key for "Checking for updates..."
    try {
        const result = await window.api.manualCheckUpdates();
        
        if (result.success) {
            if (result.updateAvailable && result.updateInfo) {
                const msg = t('msg_new_version', { version: result.updateInfo.version }) || `Neue Version v${result.updateInfo.version} gefunden!`;
                showToast(msg, 'success', true);

                const banner = document.getElementById('update-banner');
                const text = document.getElementById('update-text');
                const downloadBtn = document.getElementById('update-download-btn');
                const installBtn = document.getElementById('update-install-btn');
                const manualBtn = document.getElementById('update-manual-btn');
                
                text.textContent = msg;
                banner.classList.remove('hidden');
                downloadBtn.classList.remove('hidden');
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
                installBtn.classList.add('hidden');
                if (manualBtn) manualBtn.classList.add('hidden');
                
                showScreen('main-screen');
            } else {
                showToast('msg_no_update', 'info');
            }
        } else {
            // Check for specific 404 or common update errors
            if (result.error && (result.error.includes('404') || result.error.includes('Not Found'))) {
                showToast('msg_no_update', 'info');
            } else {
                showToast('msg_update_error', 'error');
            }
        }
    } catch (err) {
        showToast('msg_update_error', 'error');
    }
}

// CSV Import Logic
async function selectCsvFile() {
    const { filePaths } = await window.api.showOpenDialog({
        title: 'Select Browser CSV Export',
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
        const path = filePaths[0];
        document.getElementById('csv-file-path').textContent = path;
        document.getElementById('csv-file-path').dataset.path = path;
    }
}

async function handleCsvImport() {
    const filePath = document.getElementById('csv-file-path').dataset.path;
    if (!filePath) {
        showToast('msg_select_csv', 'error');
        return;
    }

    try {
        const result = await window.api.readFile(filePath);
        if (!result.success) throw new Error(result.error);

        const content = atob(result.data);
        const rows = parseCSV(content);
        
        if (rows.length < 2) {
            showToast('msg_csv_empty', 'error');
            return;
        }

        const headers = rows[0].map(h => h.toLowerCase().trim());
        const importedData = [];

        // Detect format
        const isChrome = headers.includes('url') && headers.includes('username') && headers.includes('password');
        const isFirefox = headers.includes('url') && headers.includes('username') && headers.includes('password') && headers.includes('httprealm');

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row.length < 3) continue;

            let entry = {};
            if (isChrome || isFirefox) {
                const urlIdx = headers.indexOf('url');
                const userIdx = headers.indexOf('username');
                const pwdIdx = headers.indexOf('password');
                const nameIdx = headers.indexOf('name');
                const noteIdx = headers.indexOf('note');

                entry = {
                    app: (nameIdx !== -1 && row[nameIdx]) ? row[nameIdx] : (row[urlIdx] || 'Imported'),
                    link: row[urlIdx] || '',
                    username: row[userIdx] || '',
                    password: row[pwdIdx] || '',
                    notes: (noteIdx !== -1) ? (row[noteIdx] || '') : 'Imported',
                    folderId: null,
                    files: []
                };
            } else {
                // Fallback: try columns as Name, Url, User, Pwd, Note if 5 columns
                if (row.length >= 5) {
                    entry = {
                        app: row[0] || 'Imported',
                        link: row[1] || '',
                        username: row[2] || '',
                        password: row[3] || '',
                        notes: row[4] || '',
                        folderId: null,
                        files: []
                    };
                } else {
                    entry = {
                        app: row[0] || 'Imported',
                        username: row[1] || '',
                        password: row[2] || '',
                        link: '',
                        notes: 'Imported (unknown format)',
                        folderId: null,
                        files: []
                    };
                }
            }
            
            if (entry.app && entry.password) {
                importedData.push(entry);
            }
        }

        if (importedData.length === 0) {
            showToast('msg_csv_no_valid', 'error');
            return;
        }

        // Merge with existing
        let added = 0;
        importedData.forEach(imp => {
            // Simple duplicate check (app name only as requested)
            const exists = passwords.some(p => p.app === imp.app);
            if (!exists) {
                passwords.push(imp);
                added++;
            }
        });

        const saveResult = await window.api.savePasswords({
            password: currentPassword,
            passwords,
            folders,
            trash // Fix Bug A: pass trash parameter
        });

        if (saveResult.success) {
            showToast(`${added} entries imported successfully!`, 'success');
            renderPasswordList();
            showScreen('settings-screen');
        } else {
            showToast('Error saving imported data!', 'error');
        }

    } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
    }
}

function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField);
            currentField = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (currentField || currentRow.length > 0) {
                currentRow.push(currentField);
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
            if (char === '\r' && nextChar === '\n') i++;
        } else {
            currentField += char;
        }
    }
    
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    return rows;
}

// ═══════════════════════════════════════════════════════════════════════
// LICENSING SYSTEM
// ═══════════════════════════════════════════════════════════════════════

async function checkLicenseStatus(forceSync = false) {
    try {
        const loadRes = await window.api.loadLicense();
        if (!loadRes.success) {
            licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false, securityAudit: false } };
            return false;
        }

        const cached = loadRes.license;
        const now = Date.now();
        const lastSync = cached.lastSync || 0;
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const isOfflineLimitExceeded = (now - lastSync) > thirtyDaysMs;

        const isOnline = navigator.onLine;

        // Only check online once per calendar month (and year)
        const lastSyncDate = new Date(lastSync);
        const currentDate = new Date(now);
        const isSameMonth = lastSync && 
                            lastSyncDate.getFullYear() === currentDate.getFullYear() && 
                            lastSyncDate.getMonth() === currentDate.getMonth();

        if (isOnline && !isSameMonth) {
            const deviceId = await window.api.getDeviceId();
            try {
                const response = await fetch(`${API_BASE_URL}/api/validate-license`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ licenseKey: cached.licenseKey, deviceId })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.valid) {
                        const isPremiumOrLifetime = data.plan !== 'free' && data.plan !== 'trial' && data.plan !== 'none';
                        const enforcedFeatures = data.features ? {
                            ...data.features,
                            passwordGenerator: isPremiumOrLifetime || data.features.passwordGenerator,
                            securityAudit: isPremiumOrLifetime || data.features.securityAudit
                        } : {
                            passwordGenerator: isPremiumOrLifetime,
                            securityAudit: isPremiumOrLifetime
                        };
                        const updatedLicense = {
                            licenseKey: cached.licenseKey,
                            plan: data.plan,
                            features: enforcedFeatures,
                            expiryDate: data.expiryDate,
                            lastSync: Date.now()
                        };
                        await window.api.saveLicense(updatedLicense);
                        licenseState = {
                            valid: true,
                            plan: data.plan,
                            features: enforcedFeatures,
                            expiryDate: data.expiryDate,
                            lastSync: Date.now()
                        };
                        updateSettingsLicenseUI();
                        return true;
                    } else {
                        await window.api.deleteLicense();
                        licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false, securityAudit: false } };
                        updateSettingsLicenseUI();
                        return false;
                    }
                }
            } catch (fetchErr) {
                console.error('Failed to contact licensing server during sync:', fetchErr);
            }
        }

        if (isOfflineLimitExceeded) {
            licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false, securityAudit: false }, error: 'offline_sync_required' };
            updateSettingsLicenseUI();
            return false;
        }

        if (cached.expiryDate) {
            const expiry = new Date(cached.expiryDate);
            if (expiry.getTime() < now) {
                licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false, securityAudit: false } };
                updateSettingsLicenseUI();
                return false;
            }
        }

        const isPremiumPlan = cached.plan !== 'free' && cached.plan !== 'trial' && cached.plan !== 'none';
        licenseState = {
            valid: true,
            plan: cached.plan,
            features: cached.features || { 
                passwordGenerator: isPremiumPlan,
                securityAudit: isPremiumPlan
            },
            expiryDate: cached.expiryDate,
            lastSync: cached.lastSync
        };
        updateSettingsLicenseUI();
        return true;
    } catch (err) {
        console.error('Error in checkLicenseStatus:', err);
        return false;
    }
}

function updateSettingsLicenseUI() {
    const statusEl = document.getElementById('settings-license-status');
    const planEl = document.getElementById('settings-license-plan');
    const expiryEl = document.getElementById('settings-license-expiry');
    const syncEl = document.getElementById('settings-license-sync');

    if (licenseState.valid) {
        if (statusEl) {
            statusEl.textContent = 'Active';
            statusEl.style.color = 'var(--color-success)';
        }
        if (planEl) planEl.textContent = licenseState.plan.toUpperCase();
        if (expiryEl) {
            expiryEl.textContent = licenseState.expiryDate 
                ? new Date(licenseState.expiryDate).toLocaleDateString() 
                : 'Lifetime';
        }
        if (syncEl) {
            syncEl.textContent = licenseState.lastSync 
                ? new Date(licenseState.lastSync).toLocaleString() 
                : 'N/A';
        }
    } else {
        if (statusEl) {
            statusEl.textContent = licenseState.error === 'offline_sync_required' ? 'Sync Required (30 Days Offline)' : 'Inactive';
            statusEl.style.color = 'var(--color-danger)';
        }
        if (planEl) planEl.textContent = '-';
        if (expiryEl) expiryEl.textContent = '-';
        if (syncEl) syncEl.textContent = '-';
    }
}

async function handleActivateLicense() {
    const licenseKey = document.getElementById('license-key-input').value.trim();
    const errorEl = document.getElementById('license-error-msg');
    
    if (!licenseKey) {
        errorEl.textContent = 'Please enter a license key.';
        errorEl.classList.remove('hidden');
        return;
    }

    if (!navigator.onLine) {
        errorEl.textContent = 'Internet connection is required to activate a license.';
        errorEl.classList.remove('hidden');
        return;
    }

    errorEl.textContent = 'Activating...';
    errorEl.classList.remove('hidden');

    try {
        const deviceId = await window.api.getDeviceId();
        const response = await fetch(`${API_BASE_URL}/api/validate-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceId })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        if (data.valid) {
            const isPremiumOrLifetime = data.plan !== 'free' && data.plan !== 'trial' && data.plan !== 'none';
            const enforcedFeatures = data.features ? {
                ...data.features,
                passwordGenerator: isPremiumOrLifetime || data.features.passwordGenerator,
                securityAudit: isPremiumOrLifetime || data.features.securityAudit
            } : {
                passwordGenerator: isPremiumOrLifetime,
                securityAudit: isPremiumOrLifetime
            };
            const licenseData = {
                licenseKey,
                plan: data.plan,
                features: enforcedFeatures,
                expiryDate: data.expiryDate,
                lastSync: Date.now()
            };
            const saveRes = await window.api.saveLicense(licenseData);
            if (saveRes.success) {
                licenseState = {
                    valid: true,
                    plan: data.plan,
                    features: enforcedFeatures,
                    expiryDate: data.expiryDate,
                    lastSync: Date.now()
                };
                errorEl.classList.add('hidden');
                showToast('msg_license_activated', 'success');
                
                // License activated → proceed to login or register
                const isFirstRun = await window.api.checkFirstRun();
                if (isFirstRun) {
                    showScreen('register-screen');
                } else {
                    showScreen('login-screen');
                }
            } else {
                errorEl.textContent = 'Failed to save license locally.';
            }
        } else {
            if (data.error === 'device_limit_exceeded') {
                errorEl.textContent = 'Device limit reached. Only 1 device is allowed for Free Trial, up to 50 devices for Premium, and up to 100 devices for Lifetime.';
            } else if (data.error === 'license_expired') {
                errorEl.textContent = 'This license has expired. Please buy a new license.';
            } else if (data.error === 'license_inactive') {
                errorEl.textContent = 'This license is inactive.';
            } else {
                errorEl.textContent = 'Invalid license key. Please check your spelling and try again.';
            }
        }
    } catch (err) {
        console.error('License activation error:', err);
        errorEl.textContent = 'Activation failed. Please ensure you are connected to the internet and try again.';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// PASSWORT-SICHERHEITS-AUDIT
// ═══════════════════════════════════════════════════════════════════════

let auditResults = [];
let auditLeakedSet = new Set();

async function openSecurityAudit() {
    if (!hasPaidAccess()) {
        showToast('msg_license_req_watchtower', 'warning');
        return;
    }
    showScreen('audit-screen');
    updateSidebarActive('watchtower');
    
    // Reset UI
    document.getElementById('audit-scanning').style.display = 'block';
    document.getElementById('audit-summary').style.display = 'none';
    document.getElementById('audit-filters').style.display = 'none';
    document.getElementById('audit-results').innerHTML = '';
    document.getElementById('audit-progress').textContent = t('audit_analyzing');
    
    auditResults = [];
    auditLeakedSet = new Set();

    try {
        // Step 1: Local audit (weak, reused)
        const auditRes = await window.api.passwordAudit({ password: currentPassword });
        if (!auditRes.success) {
            showToast(auditRes.error || 'msg_error', 'error');
            return;
        }
        auditResults = auditRes.results;

        // Step 2: HaveIBeenPwned Leak Check (K-Anonymity)
        document.getElementById('audit-progress').textContent = t('audit_checking_leaks', { current: 0, total: auditResults.length });
        
        for (let i = 0; i < auditResults.length; i++) {
            const entry = auditResults[i];
            document.getElementById('audit-progress').textContent = t('audit_checking_leaks', { current: i + 1, total: auditResults.length });

            try {
                // SHA-1 Hash im Browser berechnen
                const pwd = passwords.find(p => p.app === entry.app && p.username === entry.username);
                if (pwd && pwd.password) {
                    const encoder = new TextEncoder();
                    const data = encoder.encode(pwd.password);
                    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    
                    const pwnResult = await window.api.checkPwned({ passwordHash: hashHex });
                    if (pwnResult.success && pwnResult.pwned) {
                        entry.issues.push('leaked');
                        entry.leakCount = pwnResult.count;
                        auditLeakedSet.add(entry.app + ':' + entry.username);
                    }
                }
            } catch (e) {
                // Leak-Check fehlgeschlagen – nicht kritisch
                console.warn('[Audit] Leak check failed for', entry.app, e.message);
            }

            // Rate-Limiting: 100ms Pause zwischen API-Anfragen
            if (i < auditResults.length - 1) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        // Step 3: Ergebnisse anzeigen
        document.getElementById('audit-scanning').style.display = 'none';
        renderAuditSummary();
        renderAuditResults('all');
        setupAuditFilters();

    } catch (err) {
        showToast(err.message || 'msg_error', 'error');
    }
}

function renderAuditSummary() {
    const total = auditResults.length;
    const weak = auditResults.filter(r => r.issues.some(i => i.startsWith('weak'))).length;
    const reused = auditResults.filter(r => r.issues.includes('reused')).length;
    const leaked = auditResults.filter(r => r.issues.includes('leaked')).length;
    const strong = auditResults.filter(r => r.issues.length === 0).length;

    document.getElementById('audit-total').textContent = total;
    document.getElementById('audit-strong').textContent = strong;
    document.getElementById('audit-weak').textContent = weak;
    document.getElementById('audit-reused').textContent = reused;
    document.getElementById('audit-leaked').textContent = leaked;
    
    document.getElementById('audit-summary').style.display = 'grid';
    document.getElementById('audit-filters').style.display = 'flex';
}

function setupAuditFilters() {
    const filterBtns = document.querySelectorAll('.audit-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAuditResults(btn.dataset.filter);
        });
    });
}

function renderAuditResults(filter) {
    const container = document.getElementById('audit-results');
    container.innerHTML = '';

    let filtered = auditResults;
    if (filter === 'weak') {
        filtered = auditResults.filter(r => r.issues.some(i => i.startsWith('weak')));
    } else if (filter === 'reused') {
        filtered = auditResults.filter(r => r.issues.includes('reused'));
    } else if (filter === 'leaked') {
        filtered = auditResults.filter(r => r.issues.includes('leaked'));
    } else if (filter === 'strong') {
        filtered = auditResults.filter(r => r.issues.length === 0);
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>${filter === 'strong' ? t('audit_empty_strong') : t('audit_empty_issues')}</p></div>`;
        return;
    }

    filtered.forEach(result => {
        const card = document.createElement('div');
        card.className = 'audit-result-card';

        const hasWeak = result.issues.some(i => i.startsWith('weak'));
        const hasReused = result.issues.includes('reused');
        const hasLeaked = result.issues.includes('leaked');
        const isStrong = result.issues.length === 0;

        // Stärke-Farbe
        let strengthColor = '#ef4444'; // red
        if (result.strength >= 70) strengthColor = '#22c55e'; // green
        else if (result.strength >= 45) strengthColor = '#f59e0b'; // amber

        let badges = '';
        if (hasLeaked) badges += '<span class="audit-badge audit-badge-leaked">🔓 ' + t('audit_leaked') + (result.leakCount ? ` (${result.leakCount.toLocaleString()}x)` : '') + '</span>';
        if (hasWeak) badges += '<span class="audit-badge audit-badge-weak">' + t('audit_filter_weak') + '</span>';
        if (hasReused) badges += '<span class="audit-badge audit-badge-reused">🔄 ' + t('audit_reused') + ' (' + result.reusedCount + ')</span>';
        if (isStrong) badges += '<span class="audit-badge audit-badge-strong">' + t('audit_filter_strong') + '</span>';

        card.innerHTML = `
            <div class="audit-result-header">
                <div class="audit-result-app">${escapeHtml(result.app)}</div>
                <div class="audit-result-user">${escapeHtml(result.username)}</div>
            </div>
            <div class="audit-result-body">
                <div class="audit-strength-bar">
                    <div class="audit-strength-fill" style="width: ${result.strength}%; background: ${strengthColor};"></div>
                </div>
                <span class="audit-strength-label" style="color: ${strengthColor};">${result.strength}%</span>
            </div>
            <div class="audit-badges">${badges}</div>
        `;

        container.appendChild(card);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// NATIVE MESSAGING IPC HANDLER (FROM CHROME EXTENSION)
// ═══════════════════════════════════════════════════════════════════════
if (window.api && window.api.onNativeRequest) {
    window.api.onNativeRequest(async ({ id, request }) => {
        if (request.action === "ping") {
            window.api.sendNativeResponse({ id, response: { action: "ping", success: true, status: currentPassword ? "unlocked" : "locked" } });
            return;
        }

        // Only process requests if app is unlocked
        if (!currentPassword) {
            window.api.sendNativeResponse({ id, response: { action: (request.action || "").replace('request', 'response'), success: false, error: 'Locked' } });
            return;
        }

        if (request.action === "get-credentials") {
            const matched = passwords.filter(p => p.link && p.link.toLowerCase().includes(request.domain.toLowerCase()));
            window.api.sendNativeResponse({ 
                id, 
                response: { 
                    action: "credentials-response", 
                    success: true, 
                    credentials: matched.map(p => ({ username: p.username, password: p.password })) 
                } 
            });
        }
        else if (request.action === "check-exists") {
            const existing = passwords.find(p => p.link && p.link.toLowerCase().includes(request.domain.toLowerCase()) && p.username === request.username);
            if (!existing) {
                window.api.sendNativeResponse({ id, response: { action: "check-response", shouldSave: true, isUpdate: false } });
            } else if (existing.password !== request.password) {
                window.api.sendNativeResponse({ id, response: { action: "check-response", shouldSave: true, isUpdate: true } });
            } else {
                window.api.sendNativeResponse({ id, response: { action: "check-response", shouldSave: false } });
            }
        }
        else if (request.action === "save-credential") {
            const { domain, username, password, isUpdate } = request;
            if (isUpdate) {
                const existing = passwords.find(p => p.link && p.link.toLowerCase().includes(domain.toLowerCase()) && p.username === username);
                if (existing) {
                    existing.password = password;
                }
            } else {
                passwords.push({
                    app: domain.charAt(0).toUpperCase() + domain.slice(1),
                    link: 'https://' + domain,
                    username: username,
                    password: password,
                    notes: 'Saved automatically by PassSafer Browser Extension.',
                    folderId: null,
                    files: []
                });
            }

            const result = await window.api.savePasswords({ password: currentPassword, passwords, folders });
            window.api.sendNativeResponse({ id, response: { action: "save-response", success: result.success } });
            
            // Refresh UI if on main screen
            const mainScreen = document.getElementById('main-screen');
            if (mainScreen && !mainScreen.classList.contains('hidden')) {
                renderPasswordList();
                showToast('msg_sync_from_ext', 'success');
            }
        }
        else if (request.action === "request-vault") {
            // Browser-Erweiterung fordert die verschlüsselte Datenbank an (für entkoppelten Cache)
            try {
                const loadResult = await window.api.loadPasswords({ password: currentPassword });
                if (loadResult.success) {
                    window.api.sendNativeResponse({
                        id,
                        response: {
                            action: "vault-response",
                            success: true,
                            masterPassword: currentPassword,
                            vault: {
                                passwords: loadResult.data,
                                folders: loadResult.folders
                            }
                        }
                    });
                } else {
                    window.api.sendNativeResponse({ id, response: { action: "vault-response", success: false, error: loadResult.error } });
                }
            } catch (e) {
                window.api.sendNativeResponse({ id, response: { action: "vault-response", success: false, error: e.message } });
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// NEW SCREEN LOGIC & EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════

let currentEditIdIndex = null;
let currentEditDocIndex = null;
let currentEditCardIndex = null;

document.addEventListener('click', (e) => {
    // Product Hunt Banner global handlers
    if (e.target.closest('#ph-rate-btn')) {
        window.api.openExternal('https://www.producthunt.com');
        localStorage.setItem('ph_dismissed', 'true');
        checkProductHuntBanner();
    } else if (e.target.closest('#ph-later-btn')) {
        const snoozeUntil = Date.now() + 2 * 24 * 60 * 60 * 1000;
        localStorage.setItem('ph_snoozed_until', snoozeUntil.toString());
        checkProductHuntBanner();
    } else if (e.target.closest('#ph-dismiss-btn')) {
        localStorage.setItem('ph_dismissed', 'true');
        checkProductHuntBanner();
    }
});

function setupNewEventListeners() {
    // Sidebar Navigation
    setupSidebarNavigation();

    // Drag & Drop sidebar listeners
    setupDragAndDrop();

    // Dashboard Quick Actions
    document.getElementById('qa-add-password').addEventListener('click', showAddPassword);
    document.getElementById('qa-watchtower').addEventListener('click', openSecurityAudit);
    document.getElementById('qa-export').addEventListener('click', () => {
        document.getElementById('export-password').value = '';
        showScreen('export-screen');
        updateSidebarActive('export');
    });

    // Product Hunt / Review Banner handlers moved to global delegated listener below

    // Onboarding Listeners
    const onboardingNextBtn = document.getElementById('onboarding-next-btn');
    if (onboardingNextBtn) {
        onboardingNextBtn.addEventListener('click', () => {
            if (onboardingCurrentStep < ONBOARDING_STEPS - 1) {
                showOnboardingStep(onboardingCurrentStep + 1);
            } else {
                finishOnboarding();
            }
        });
    }

    const onboardingSkipBtn = document.getElementById('onboarding-skip-btn');
    if (onboardingSkipBtn) {
        onboardingSkipBtn.addEventListener('click', finishOnboarding);
    }

    // Initialize custom select dropdowns
    initializeCustomSelects();

    const restartOnboardingBtn = document.getElementById('restart-onboarding-btn');
    if (restartOnboardingBtn) {
        restartOnboardingBtn.addEventListener('click', () => {
            localStorage.removeItem('onboarding_completed');
            onboardingCurrentStep = 0;
            showScreen('main-screen');
            updateSidebarActive('dashboard');
            showOnboardingStep(0);
        });
    }

    // Monthly Report Close & Delete
    document.getElementById('report-close-btn').addEventListener('click', () => {
        showReportsScreen();
        currentActiveReport = null;
    });
    document.getElementById('report-cancel-btn').addEventListener('click', () => {
        showReportsScreen();
        currentActiveReport = null;
    });
    document.getElementById('report-delete-btn').addEventListener('click', handleDeleteReport);

    // Empty Trash
    document.getElementById('empty-trash-btn').addEventListener('click', handleEmptyTrash);

    // Search Box Inputs
    document.getElementById('trash-search-input').addEventListener('input', renderTrashList);
    document.getElementById('ids-search-input').addEventListener('input', renderIdsList);
    document.getElementById('docs-search-input').addEventListener('input', renderDocumentsList);
    document.getElementById('cards-search-input').addEventListener('input', renderCardsList);

    // ID Screen Actions
    document.getElementById('add-id-btn').addEventListener('click', showAddId);
    document.getElementById('save-id-btn').addEventListener('click', handleSaveId);
    document.getElementById('delete-id-btn').addEventListener('click', handleDeleteId);
    document.getElementById('cancel-id-btn').addEventListener('click', showIdsScreen);
    document.getElementById('close-edit-id-btn').addEventListener('click', showIdsScreen);
    document.getElementById('upload-id-file-btn').addEventListener('click', handleIdFileUpload);

    // Document Screen Actions
    document.getElementById('add-document-btn').addEventListener('click', showAddDocument);
    document.getElementById('save-doc-btn').addEventListener('click', handleSaveDocument);
    document.getElementById('delete-doc-btn').addEventListener('click', handleDeleteDocument);
    document.getElementById('cancel-doc-btn').addEventListener('click', showDocumentsScreen);
    document.getElementById('close-edit-doc-btn').addEventListener('click', showDocumentsScreen);
    document.getElementById('upload-doc-file-btn').addEventListener('click', handleDocFileUpload);

    // Credit Card Actions
    document.getElementById('add-card-btn').addEventListener('click', showAddCard);
    document.getElementById('save-card-btn').addEventListener('click', handleSaveCard);
    document.getElementById('delete-card-btn').addEventListener('click', handleDeleteCard);
    document.getElementById('cancel-card-btn').addEventListener('click', showCardsScreen);
    document.getElementById('close-edit-card-btn').addEventListener('click', showCardsScreen);
}

function hasPaidAccess() {
    return licenseState.valid &&
           (licenseState.plan === 'premium' || licenseState.plan === 'lifetime');
}

function setupSidebarNavigation() {
    document.querySelectorAll('#sidebar .nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const isTourHighlight = item.classList.contains('onboarding-highlight');
            const navId = item.getAttribute('data-nav');
            if (navId === 'dashboard') {
                showDashboard();
            } else if (navId === 'passwords') {
                currentFolder = null;
                showMainScreen();
            } else if (navId === 'trash') {
                if (!hasPaidAccess()) {
                    showToast('msg_license_req_trash', 'warning');
                    return;
                }
                showTrashScreen();
            } else if (navId === 'watchtower') {
                if (!hasPaidAccess()) {
                    showToast('msg_license_req_watchtower', 'warning');
                    return;
                }
                openSecurityAudit();
            } else if (navId === 'ids') {
                if (!hasPaidAccess()) {
                    showToast('msg_license_req_ids', 'warning');
                    return;
                }
                showIdsScreen();
            } else if (navId === 'documents') {
                showDocumentsScreen();
            } else if (navId === 'cards') {
                showCardsScreen();
            } else if (navId === 'reports') {
                showReportsScreen();
            } else if (navId === 'import') {
                document.getElementById('import-password').value = '';
                document.getElementById('import-file-path').textContent = t('label_no_file_selected');
                document.getElementById('import-file-path').dataset.path = '';
                showScreen('import-screen');
                updateSidebarActive('import');
            } else if (navId === 'export') {
                document.getElementById('export-password').value = '';
                showScreen('export-screen');
                updateSidebarActive('export');
            } else if (navId === 'csv-import') {
                document.getElementById('csv-file-path').textContent = t('label_no_file_selected');
                document.getElementById('csv-file-path').dataset.path = '';
                showScreen('csv-import-screen');
                updateSidebarActive('csv-import');
            } else if (navId === 'settings') {
                showSettings();
            }
        });
    });
}

function updateSidebarActive(navId) {
    document.querySelectorAll('#sidebar .nav-item').forEach(item => {
        if (item.getAttribute('data-nav') === navId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

async function showDashboard() {
    showScreen('dashboard-screen');
    updateSidebarActive('dashboard');

    const hour = new Date().getHours();
    let greetingKey = 'dashboard_welcome_morning';
    if (hour >= 12 && hour < 18) {
        greetingKey = 'dashboard_welcome_afternoon';
    } else if (hour >= 18 || hour < 5) {
        greetingKey = 'dashboard_welcome_evening';
    }
    document.getElementById('dashboard-greeting').textContent = t(greetingKey, { username: currentUser });

    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const localeStr = currentLanguage === 'de' ? 'de-DE' : currentLanguage === 'es' ? 'es-ES' : currentLanguage === 'fr' ? 'fr-FR' : 'en-US';
    document.getElementById('dashboard-date').textContent = new Date().toLocaleDateString(localeStr, dateOptions);

    const totalPasswords = passwords.length;
    const totalFolders = folders.length;

    let weakCount = 0;
    let reusedCount = 0;
    let strongCount = 0;
    let score = 100;

    if (totalPasswords > 0) {
        try {
            const auditRes = await window.api.passwordAudit({ password: currentPassword });
            if (auditRes.success) {
                const results = auditRes.results;
                weakCount = results.filter(r => r.issues.some(i => i.startsWith('weak'))).length;
                reusedCount = results.filter(r => r.issues.includes('reused')).length;
                strongCount = results.filter(r => r.issues.length === 0).length;
                score = Math.round((strongCount / totalPasswords) * 100);
            }
        } catch (e) {
            console.error('Failed to calculate dashboard security score:', e);
        }
    }

    document.getElementById('stat-total-passwords').textContent = totalPasswords;
    document.getElementById('stat-total-folders').textContent = totalFolders;
    document.getElementById('stat-strong').textContent = `${totalPasswords > 0 ? Math.round((strongCount / totalPasswords) * 100) : 100}%`;
    document.getElementById('stat-weak').textContent = weakCount + reusedCount;

    document.getElementById('dashboard-score').textContent = score;
    const ringFill = document.getElementById('score-ring-fill');
    if (ringFill) {
        const circumference = 2 * Math.PI * 52;
        ringFill.style.strokeDasharray = circumference;
        const offset = circumference - (score / 100) * circumference;
        ringFill.style.strokeDashoffset = offset;
        if (score >= 80) ringFill.style.stroke = '#22c55e';
        else if (score >= 50) ringFill.style.stroke = '#ff8c00';
        else ringFill.style.stroke = '#e74c3c';
    }

    const recentContainer = document.getElementById('recent-passwords');
    recentContainer.innerHTML = '';
    const recent = passwords.slice().reverse().slice(0, 5);
    if (recent.length === 0) {
        recentContainer.innerHTML = `<p class="hint">${t('msg_no_passwords')}</p>`;
    } else {
        recent.forEach((pwd, idx) => {
            const domain = pwd.domain || pwd.url || pwd.link || '';
            const faviconUrl = getFaviconUrl(domain);
            const firstLetter = (pwd.app || '?').charAt(0).toUpperCase();
            const isLocal = isLocalNetwork(domain);
            const recentIconId = 'recent-icon-' + (pwd.id || idx);

            let iconHtml = '';
            if (faviconUrl) {
                iconHtml = `
                    <div class="password-card-icon" data-icon-id="${recentIconId}">
                        <img src="${faviconUrl}" alt="${firstLetter}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=&quot;password-card-icon-letter&quot;>${firstLetter}</span>';">
                    </div>
                `;
            } else {
                iconHtml = `
                    <div class="password-card-icon" data-icon-id="${recentIconId}">
                        <span class="password-card-icon-letter">${firstLetter}</span>
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = 'password-card';
            card.innerHTML = `
                <div style="display: flex; align-items: center;">
                    ${iconHtml}
                    <span class="password-card-name">${escapeHtml(pwd.app)}</span>
                </div>
                <span class="password-card-arrow">
                    <img src="../logos/right.png" alt=">">
                </span>
            `;

            if (!faviconUrl && isLocal && window.api && window.api.fetchLocalFavicon) {
                window.api.fetchLocalFavicon(domain).then(localDataUrl => {
                    if (localDataUrl) {
                        const container = card.querySelector(`[data-icon-id="${recentIconId}"]`);
                        if (container) {
                            container.innerHTML = `<img src="${localDataUrl}" alt="${firstLetter}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=&quot;password-card-icon-letter&quot;>${firstLetter}</span>';">`;
                        }
                    }
                }).catch(() => {});
            }

            const actualIndex = passwords.indexOf(pwd);
            card.addEventListener('click', () => showPasswordDetail(actualIndex));
            recentContainer.appendChild(card);
        });
    }

    checkProductHuntBanner();
    checkAndGenerateMonthlyReport(score, totalPasswords, strongCount, weakCount, reusedCount);
}

function checkProductHuntBanner() {
    const banner = document.getElementById('producthunt-banner');
    if (!banner) return;

    if (licenseState.valid) {
        banner.classList.add('hidden');
        banner.style.display = 'none';
        return;
    }

    const dismissed = localStorage.getItem('ph_dismissed') === 'true';
    const snoozedUntil = localStorage.getItem('ph_snoozed_until');
    const now = Date.now();

    if (dismissed || (snoozedUntil && now < parseInt(snoozedUntil))) {
        banner.classList.add('hidden');
        banner.style.display = 'none';
    } else {
        banner.classList.remove('hidden');
        banner.style.display = 'flex';
    }
}

function setupCustomSelect() {
    const trigger = document.getElementById('custom-folder-trigger');
    if (trigger) {
        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            const options = document.getElementById('custom-folder-options');
            if (options) {
                const isHidden = options.classList.contains('select-hide');
                closeAllCustomSelects();
                if (isHidden) {
                    options.classList.remove('select-hide');
                    this.classList.add('select-arrow-active');
                }
            }
        });
    }

    document.addEventListener('click', () => closeAllCustomSelects());
}

function initializeCustomSelects() {
    const selects = document.querySelectorAll('select.folder-select');
    selects.forEach(selectEl => {
        setupSingleCustomSelect(selectEl);
    });
}

function setupSingleCustomSelect(selectEl) {
    if (!selectEl) return;

    let container = selectEl.parentElement;
    if (!container.classList.contains('custom-select-container')) {
        container = document.createElement('div');
        container.className = 'custom-select-container';
        if (selectEl.style.width) container.style.width = selectEl.style.width;
        if (selectEl.style.minWidth) container.style.minWidth = selectEl.style.minWidth;
        selectEl.parentNode.insertBefore(container, selectEl);
        container.appendChild(selectEl);
    }

    selectEl.style.display = 'none';

    let trigger = container.querySelector(':scope > .select-selected');
    if (!trigger) {
        trigger = document.createElement('div');
        trigger.className = 'select-selected';
        container.appendChild(trigger);

        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            const items = container.querySelector('.select-items');
            if (!items) return;
            const isHidden = items.classList.contains('select-hide');
            closeAllCustomSelects();
            if (isHidden) {
                items.classList.remove('select-hide');
                trigger.classList.add('select-arrow-active');
            }
        });
    }

    let itemsContainer = container.querySelector(':scope > .select-items');
    if (!itemsContainer) {
        itemsContainer = document.createElement('div');
        itemsContainer.className = 'select-items select-hide';
        container.appendChild(itemsContainer);
    }

    refreshCustomSelectOptions(selectEl);
}

function refreshCustomSelectOptions(selectEl) {
    if (!selectEl) return;
    const container = selectEl.closest('.custom-select-container');
    if (!container) return;
    const trigger = container.querySelector(':scope > .select-selected');
    const itemsContainer = container.querySelector(':scope > .select-items');
    if (!trigger || !itemsContainer) return;

    itemsContainer.innerHTML = '';

    const selectedOption = selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
    trigger.textContent = selectedOption ? selectedOption.textContent : '';

    Array.from(selectEl.options).forEach((opt, idx) => {
        const item = document.createElement('div');
        item.textContent = opt.textContent;
        item.dataset.value = opt.value;
        if (idx === selectEl.selectedIndex) {
            item.classList.add('same-as-selected');
        }

        item.addEventListener('click', function (e) {
            e.stopPropagation();
            selectEl.selectedIndex = idx;
            selectEl.value = opt.value;
            trigger.textContent = opt.textContent;

            itemsContainer.querySelectorAll('div').forEach(d => d.classList.remove('same-as-selected'));
            item.classList.add('same-as-selected');

            itemsContainer.classList.add('select-hide');
            trigger.classList.remove('select-arrow-active');

            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });

        itemsContainer.appendChild(item);
    });
}

function syncCustomSelect(selectEl) {
    if (typeof selectEl === 'string') selectEl = document.getElementById(selectEl);
    if (!selectEl) return;
    const container = selectEl.closest('.custom-select-container');
    if (!container) return;
    const trigger = container.querySelector(':scope > .select-selected');
    const itemsContainer = container.querySelector(':scope > .select-items');
    if (!trigger || !itemsContainer) return;

    const selectedOption = selectEl.options[selectEl.selectedIndex];
    if (selectedOption) {
        trigger.textContent = selectedOption.textContent;
        itemsContainer.querySelectorAll('div').forEach(d => {
            d.classList.toggle('same-as-selected', d.dataset.value === selectEl.value);
        });
    }
}

function closeAllCustomSelects(elmnt) {
    document.querySelectorAll('.select-items').forEach(el => {
        if (!elmnt || el !== elmnt.nextElementSibling) {
            el.classList.add('select-hide');
        }
    });
    document.querySelectorAll('.select-selected').forEach(el => {
        if (!elmnt || el !== elmnt) {
            el.classList.remove('select-arrow-active');
        }
    });
}

// Onboarding Trail / Feature Tour
const ONBOARDING_STEPS = 5;
let onboardingCurrentStep = 0;

const ONBOARDING_ICONS = [
    '../logos/locked.png',
    '../logos/password.png',
    '../logos/shield.png',
    '../logos/trash.png',
    '../logos/settings.png'
];

const ONBOARDING_TOUR_TARGETS = [
    null,                     // Step 0: Welcome
    '[data-nav="passwords"]',  // Step 1: Passwords
    '[data-nav="watchtower"]', // Step 2: Watchtower
    '[data-nav="trash"]',      // Step 3: Trash
    '[data-nav="settings"]'    // Step 4: Settings
];

function checkOnboarding() {
    if (localStorage.getItem('onboarding_completed') === 'true') return;
    onboardingCurrentStep = 0;
    showOnboardingStep(0);
}

function showOnboardingStep(step) {
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    onboardingCurrentStep = step;

    const stepLabel = document.getElementById('onboarding-step-label');
    const title = document.getElementById('onboarding-title');
    const text = document.getElementById('onboarding-text');
    const nextBtn = document.getElementById('onboarding-next-btn');
    const iconImg = overlay.querySelector('.onboarding-icon-img');
    const spotlightBox = document.getElementById('onboarding-spotlight-box');
    const modal = overlay.querySelector('.onboarding-modal');

    const stepKey = step + 1;
    if (stepLabel) stepLabel.textContent = t('onboarding_step', { current: stepKey, total: ONBOARDING_STEPS });
    if (title) title.textContent = t(`onboarding_step${stepKey}_title`);
    if (text) text.textContent = t(`onboarding_step${stepKey}_text`);
    if (nextBtn) {
        nextBtn.textContent = step === ONBOARDING_STEPS - 1 ? t('onboarding_finish') : t('onboarding_next');
    }

    if (iconImg && ONBOARDING_ICONS[step]) iconImg.src = ONBOARDING_ICONS[step];

    // Remove previous highlights
    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });

    const currentTargetSelector = ONBOARDING_TOUR_TARGETS[step];
    if (currentTargetSelector) {
        const target = document.querySelector(currentTargetSelector);
        if (target && spotlightBox) {
            overlay.classList.add('spotlight-active');
            const rect = target.getBoundingClientRect();
            spotlightBox.style.top = Math.max(0, rect.top - 4) + 'px';
            spotlightBox.style.left = Math.max(0, rect.left - 4) + 'px';
            spotlightBox.style.width = (rect.width + 8) + 'px';
            spotlightBox.style.height = (rect.height + 8) + 'px';
            spotlightBox.classList.remove('hidden');

            // Position modal nicely to the right of sidebar
            if (modal) {
                modal.style.position = 'fixed';
                modal.style.left = Math.min(window.innerWidth - 460, rect.right + 28) + 'px';
                modal.style.top = Math.max(20, Math.min(window.innerHeight - 380, rect.top - 30)) + 'px';
            }

            // Interactive click: clicking the spotlight box triggers the action AND advances the tour
            spotlightBox.onclick = (e) => {
                e.stopPropagation();
                target.click();
                if (onboardingCurrentStep < ONBOARDING_STEPS - 1) {
                    showOnboardingStep(onboardingCurrentStep + 1);
                } else {
                    finishOnboarding();
                }
            };
        }
    } else {
        // Step 0 / Centered modal
        overlay.classList.remove('spotlight-active');
        if (spotlightBox) spotlightBox.classList.add('hidden');
        if (modal) {
            modal.style.position = 'relative';
            modal.style.left = '';
            modal.style.top = '';
        }
    }

    // Update dots
    overlay.querySelectorAll('.onboarding-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === step);
    });
}

function finishOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('spotlight-active');
    }
    const spotlightBox = document.getElementById('onboarding-spotlight-box');
    if (spotlightBox) spotlightBox.classList.add('hidden');
    localStorage.setItem('onboarding_completed', 'true');

    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });
}

// Dashboard Global Search & Command Palette
let searchSelectedIndex = -1;

function setupDashboardSearch() {
    const input = document.getElementById('dashboard-search-input');
    const clearBtn = document.getElementById('dashboard-search-clear');
    const dropdown = document.getElementById('dashboard-search-dropdown');
    const resultsContainer = document.getElementById('dashboard-search-results');

    if (!input || !dropdown || !resultsContainer) return;

    input.addEventListener('input', () => {
        const query = input.value.trim();
        if (!query) {
            dropdown.classList.add('hidden');
            if (clearBtn) clearBtn.classList.add('hidden');
            searchSelectedIndex = -1;
            return;
        }

        if (clearBtn) clearBtn.classList.remove('hidden');
        renderDashboardSearchResults(query);
    });

    input.addEventListener('keydown', (e) => {
        const items = resultsContainer.querySelectorAll('.search-result-item');
        if (!items || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            searchSelectedIndex = (searchSelectedIndex + 1) % items.length;
            updateSearchSelected(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            searchSelectedIndex = (searchSelectedIndex - 1 + items.length) % items.length;
            updateSearchSelected(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (searchSelectedIndex >= 0 && searchSelectedIndex < items.length) {
                items[searchSelectedIndex].click();
            } else if (items.length > 0) {
                items[0].click();
            }
        } else if (e.key === 'Escape') {
            dropdown.classList.add('hidden');
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.classList.add('hidden');
            dropdown.classList.add('hidden');
            searchSelectedIndex = -1;
            input.focus();
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dashboard-search-wrapper')) {
            dropdown.classList.add('hidden');
        }
    });

    input.addEventListener('focus', () => {
        if (input.value.trim()) {
            renderDashboardSearchResults(input.value.trim());
        }
    });
}

function updateSearchSelected(items) {
    items.forEach((item, idx) => {
        if (idx === searchSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function renderDashboardSearchResults(rawQuery) {
    const dropdown = document.getElementById('dashboard-search-dropdown');
    const resultsContainer = document.getElementById('dashboard-search-results');
    const input = document.getElementById('dashboard-search-input');
    const clearBtn = document.getElementById('dashboard-search-clear');
    if (!dropdown || !resultsContainer) return;

    const query = rawQuery.toLowerCase();
    searchSelectedIndex = -1;
    resultsContainer.innerHTML = '';

    const resultsByCategory = {
        features: [],
        passwords: [],
        ids: [],
        cards: [],
        documents: [],
        folders: []
    };

    // 1. System Features & Navigation
    const allFeatures = [
        {
            keywords: ['einstellung', 'einstellungen', 'setting', 'settings', 'config', 'option', 'sprache', 'language', 'account', 'ajustes', 'configuración', 'paramètres', 'langue'],
            title: t('title_settings'),
            subtitle: t('settings_app'),
            icon: '../logos/settings.png',
            action: () => showSettings()
        },
        {
            keywords: ['passwort hinzufügen', 'neues passwort', 'add password', 'new password', 'create password', 'hinzufügen', 'add', 'neu', 'añadir contraseña', 'nueva contraseña', 'ajouter mot de passe'],
            title: t('btn_add_password'),
            subtitle: t('header_passwords'),
            icon: '../logos/password.png',
            action: () => showAddPassword()
        },
        {
            keywords: ['passwörter', 'passwords', 'alle passwörter', 'all passwords', 'vault', 'tresor', 'contraseñas', 'mots de passe'],
            title: t('header_passwords'),
            subtitle: `${passwords.length} ${t('header_passwords')}`,
            icon: '../logos/password.png',
            action: () => { currentFolder = null; showMainScreen(); }
        },
        {
            keywords: ['ordner erstellen', 'neuer ordner', 'create folder', 'new folder', 'add folder', 'crear carpeta', 'créer dossier'],
            title: t('btn_create_folder'),
            subtitle: t('header_passwords'),
            icon: '../logos/addfolder.png',
            action: () => showCreateFolder()
        },
        {
            keywords: ['kreditkarte', 'kreditkarten', 'karten', 'credit card', 'cards', 'visa', 'mastercard', 'karte hinzufügen', 'tarjetas', 'cartes'],
            title: t('nav_cards') || 'Credit Cards',
            subtitle: `${cards.length} ${t('nav_cards') || 'Cards'}`,
            icon: '../logos/credit_card.png',
            action: () => showCardsScreen()
        },
        {
            keywords: ['ausweis', 'ausweise', 'pass', 'passport', 'id', 'ids', 'führerschein', 'driver', 'license', 'identificaciones', 'pièces d\'identité'],
            title: t('nav_ids') || 'IDs & Documents',
            subtitle: `${ids.length} ${t('nav_ids') || 'IDs'}`,
            icon: '../logos/id.png',
            action: () => {
                if (!hasPaidAccess()) {
                    showToast('msg_license_req_ids', 'warning');
                    return;
                }
                showIdsScreen();
            }
        },
        {
            keywords: ['dokument', 'dokumente', 'dateien', 'document', 'documents', 'files', 'upload', 'archivos', 'fichiers'],
            title: t('nav_documents') || 'Documents',
            subtitle: `${documents.length} ${t('nav_documents') || 'Documents'}`,
            icon: '../logos/documents.png',
            action: () => showDocumentsScreen()
        },
        {
            keywords: ['watchtower', 'sicherheit', 'audit', 'security', 'score', 'prüfen', 'check', 'leaked', 'weak', 'seguridad', 'sécurité'],
            title: t('nav_watchtower'),
            subtitle: t('nav_watchtower'),
            icon: '../logos/shield.png',
            action: () => {
                if (!hasPaidAccess()) {
                    showToast('msg_license_req_watchtower', 'warning');
                    return;
                }
                openSecurityAudit();
            }
        },
        {
            keywords: ['bericht', 'berichte', 'report', 'reports', 'monatsbericht', 'monthly', 'informe', 'rapport'],
            title: t('nav_reports'),
            subtitle: t('report_title'),
            icon: '../logos/report.png',
            action: () => showReportsScreen()
        },
        {
            keywords: ['papierkorb', 'trash', 'gelöscht', 'deleted', 'garbage', 'papelera', 'corbeille'],
            title: t('nav_trash'),
            subtitle: `${trash.length} ${t('nav_trash')}`,
            icon: '../logos/garbage.png',
            action: () => {
                if (!hasPaidAccess()) {
                    showToast('msg_license_req_trash', 'warning');
                    return;
                }
                showTrashScreen();
            }
        },
        {
            keywords: ['importieren', 'import', 'passwörter importieren', 'backup wiederherstellen', 'importar', 'importer'],
            title: t('header_import'),
            subtitle: t('settings_data'),
            icon: '../logos/import.png',
            action: () => {
                document.getElementById('import-password').value = '';
                document.getElementById('import-file-path').textContent = t('label_no_file_selected');
                document.getElementById('import-file-path').dataset.path = '';
                showScreen('import-screen');
                updateSidebarActive('import');
            }
        },
        {
            keywords: ['exportieren', 'export', 'passwörter exportieren', 'backup erstellen', 'exportar', 'exporter'],
            title: t('header_export'),
            subtitle: t('settings_data'),
            icon: '../logos/export.png',
            action: () => {
                document.getElementById('export-password').value = '';
                showScreen('export-screen');
                updateSidebarActive('export');
            }
        },
        {
            keywords: ['csv import', 'browser import', 'chrome import', 'csv', 'importar csv', 'importer csv'],
            title: t('settings_import_csv'),
            subtitle: t('settings_data'),
            icon: '../logos/import.png',
            action: () => {
                document.getElementById('csv-file-path').textContent = t('label_no_file_selected');
                document.getElementById('csv-file-path').dataset.path = '';
                showScreen('csv-import-screen');
                updateSidebarActive('csv-import');
            }
        },
        {
            keywords: ['onboarding', 'tour', 'anleitung', 'guide', 'tutorial', 'hilfe', 'help', 'guía', 'ayuda', 'tutoriel', 'aide'],
            title: t('settings_onboarding'),
            subtitle: t('app_title'),
            icon: '../logos/shield.png',
            action: () => {
                localStorage.removeItem('onboarding_completed');
                onboardingCurrentStep = 0;
                showScreen('main-screen');
                updateSidebarActive('dashboard');
                showOnboardingStep(0);
            }
        }
    ];

    allFeatures.forEach(feat => {
        if (feat.title.toLowerCase().includes(query) || feat.subtitle.toLowerCase().includes(query) || feat.keywords.some(k => k.includes(query) || query.includes(k))) {
            resultsByCategory.features.push({
                icon: feat.icon,
                title: feat.title,
                subtitle: feat.subtitle,
                badge: 'App',
                action: feat.action
            });
        }
    });

    // 2. Passwords
    passwords.forEach((pwd, idx) => {
        const matchApp = pwd.app && pwd.app.toLowerCase().includes(query);
        const matchUser = pwd.username && pwd.username.toLowerCase().includes(query);
        const matchUrl = pwd.url && pwd.url.toLowerCase().includes(query);
        const matchNotes = pwd.notes && pwd.notes.toLowerCase().includes(query);
        if (matchApp || matchUser || matchUrl || matchNotes) {
            const domain = pwd.domain || pwd.url || pwd.link || '';
            const faviconUrl = getFaviconUrl(domain);
            const firstLetter = (pwd.app || '?').charAt(0).toUpperCase();
            const isLocal = isLocalNetwork(domain);
            const iconId = 'search-pwd-icon-' + (pwd.id || idx);

            resultsByCategory.passwords.push({
                isPassword: true,
                domain: domain,
                isLocal: isLocal,
                iconId: iconId,
                faviconUrl: faviconUrl,
                firstLetter: firstLetter,
                icon: faviconUrl || '../logos/password.png',
                title: pwd.app,
                subtitle: pwd.username || pwd.url || (pwd.notes ? pwd.notes.slice(0, 30) : ''),
                badge: 'Password',
                action: () => showPasswordDetail(idx)
            });
        }
    });

    // 3. IDs
    ids.forEach((idItem, idx) => {
        const matchName = idItem.name && idItem.name.toLowerCase().includes(query);
        const matchNumber = idItem.number && idItem.number.toLowerCase().includes(query);
        const matchNotes = idItem.notes && idItem.notes.toLowerCase().includes(query);
        if (matchName || matchNumber || matchNotes) {
            const typeLabel = t(`id_type_${idItem.type.replace('drivers_license', 'drivers')}`) || idItem.type;
            resultsByCategory.ids.push({
                icon: '../logos/id.png',
                title: idItem.name,
                subtitle: `${typeLabel}${idItem.number ? ' • ' + idItem.number : ''}`,
                badge: 'ID',
                action: () => showEditId(idx)
            });
        }
    });

    // 4. Cards
    cards.forEach((card, idx) => {
        const matchName = card.name && card.name.toLowerCase().includes(query);
        const matchHolder = card.cardholderName && card.cardholderName.toLowerCase().includes(query);
        const matchBrand = card.brand && card.brand.toLowerCase().includes(query);
        const matchNotes = card.notes && card.notes.toLowerCase().includes(query);
        if (matchName || matchHolder || matchBrand || matchNotes) {
            resultsByCategory.cards.push({
                icon: '../logos/credit_card.png',
                title: card.name,
                subtitle: `${card.brand ? card.brand.toUpperCase() + ' ' : ''}${card.cardNumber ? '•••• ' + card.cardNumber.slice(-4) : ''}`,
                badge: 'Card',
                action: () => showEditCard(idx)
            });
        }
    });

    // 5. Documents
    documents.forEach((doc, idx) => {
        const matchTitle = doc.title && doc.title.toLowerCase().includes(query);
        const matchNotes = doc.notes && doc.notes.toLowerCase().includes(query);
        const matchFiles = doc.files && doc.files.some(f => f.name && f.name.toLowerCase().includes(query));
        if (matchTitle || matchNotes || matchFiles) {
            resultsByCategory.documents.push({
                icon: '../logos/documents.png',
                title: doc.title,
                subtitle: doc.files && doc.files.length ? `${doc.files.length} file(s)` : (doc.notes ? doc.notes.slice(0, 30) : ''),
                badge: 'Document',
                action: () => showEditDocument(idx)
            });
        }
    });

    // 6. Folders
    folders.forEach(folder => {
        if (folder.name && folder.name.toLowerCase().includes(query)) {
            const count = passwords.filter(p => p.folderId === folder.id).length;
            resultsByCategory.folders.push({
                icon: '../logos/folder.png',
                title: folder.name,
                subtitle: `${count} Passwords`,
                badge: 'Folder',
                action: () => openFolder(folder.id)
            });
        }
    });

    const categoryOrder = [
        { key: 'features', label: t('search_group_features') },
        { key: 'passwords', label: t('search_group_passwords') },
        { key: 'ids', label: t('search_group_ids') },
        { key: 'cards', label: t('search_group_cards') },
        { key: 'documents', label: t('search_group_documents') },
        { key: 'folders', label: t('search_group_folders') }
    ];

    let totalResults = 0;
    categoryOrder.forEach(({ key, label }) => {
        const items = resultsByCategory[key];
        if (items && items.length > 0) {
            totalResults += items.length;
            const groupEl = document.createElement('div');
            groupEl.className = 'search-results-group';

            const titleEl = document.createElement('div');
            titleEl.className = 'search-group-title';
            titleEl.textContent = label;
            groupEl.appendChild(titleEl);

            items.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'search-result-item';

                let iconHtml = '';
                if (item.isPassword) {
                    if (item.faviconUrl) {
                        iconHtml = `<img src="${item.faviconUrl}" alt="${item.firstLetter}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=&quot;password-card-icon-letter&quot; style=&quot;font-size:12px; font-weight:700;&quot;>${item.firstLetter}</span>';">`;
                    } else {
                        iconHtml = `<span class="password-card-icon-letter" style="font-size:12px; font-weight:700;">${item.firstLetter}</span>`;
                    }
                } else {
                    iconHtml = `<img src="${item.icon}" alt="">`;
                }

                itemEl.innerHTML = `
                    <div class="search-item-icon" ${item.iconId ? `data-icon-id="${item.iconId}"` : ''}>
                        ${iconHtml}
                    </div>
                    <div class="search-item-info">
                        <div class="search-item-title">${escapeHtml(item.title)}</div>
                        ${item.subtitle ? `<div class="search-item-subtitle">${escapeHtml(item.subtitle)}</div>` : ''}
                    </div>
                    <span class="search-item-badge">${escapeHtml(item.badge)}</span>
                `;

                if (item.isPassword && !item.faviconUrl && item.isLocal && window.api && window.api.fetchLocalFavicon) {
                    window.api.fetchLocalFavicon(item.domain).then(localDataUrl => {
                        if (localDataUrl) {
                            const iconContainer = itemEl.querySelector(`[data-icon-id="${item.iconId}"]`);
                            if (iconContainer) {
                                iconContainer.innerHTML = `<img src="${localDataUrl}" alt="${item.firstLetter}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=&quot;password-card-icon-letter&quot; style=&quot;font-size:12px; font-weight:700;&quot;>${item.firstLetter}</span>';">`;
                            }
                        }
                    }).catch(() => {});
                }

                itemEl.addEventListener('click', () => {
                    dropdown.classList.add('hidden');
                    input.value = '';
                    if (clearBtn) clearBtn.classList.add('hidden');
                    item.action();
                });

                groupEl.appendChild(itemEl);
            });

            resultsContainer.appendChild(groupEl);
        }
    });

    if (totalResults === 0) {
        resultsContainer.innerHTML = `<div class="search-empty-state">${t('search_no_results')}</div>`;
    }

    dropdown.classList.remove('hidden');
}

function isLastDayOfMonth(date = new Date()) {
    const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getDate();
    return tomorrow === 1;
}

async function checkAndGenerateMonthlyReport(score, total, strong, weak, reused) {
    const today = new Date();
    if (isLastDayOfMonth(today)) {
        const currentMonthKey = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}`;
        
        const reportExists = reports.some(r => {
            const d = new Date(r.date);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            return key === currentMonthKey;
        });

        if (!reportExists) {
            const newReport = {
                id: generateId(),
                date: today.toISOString(),
                score,
                total,
                strong,
                weak,
                reused
            };

            reports.unshift(newReport);
            if (reports.length > 6) {
                reports = reports.slice(0, 6);
            }

            await window.api.saveReports({ password: currentPassword, reports });
            generateMonthlyReport(newReport);
        }
    }
}

async function generateManualReport() {
    const totalPasswords = passwords.length;
    let weakCount = 0;
    let reusedCount = 0;
    let strongCount = 0;
    let score = 100;

    if (totalPasswords > 0) {
        try {
            const auditRes = await window.api.passwordAudit({ password: currentPassword });
            if (auditRes.success) {
                const results = auditRes.results;
                weakCount = results.filter(r => r.issues.some(i => i.startsWith('weak'))).length;
                reusedCount = results.filter(r => r.issues.includes('reused')).length;
                strongCount = results.filter(r => r.issues.length === 0).length;
                score = Math.round((strongCount / totalPasswords) * 100);
            }
        } catch (e) {
            console.error('Failed to calculate security score for manual report:', e);
        }
    }

    const today = new Date();
    const newReport = {
        id: generateId(),
        date: today.toISOString(),
        score,
        total: totalPasswords,
        strong: strongCount,
        weak: weakCount,
        reused: reusedCount
    };

    reports.unshift(newReport);
    if (reports.length > 6) {
        reports = reports.slice(0, 6);
    }

    const saveResult = await window.api.saveReports({ password: currentPassword, reports });
    if (saveResult.success) {
        showToast('report_generated_success', 'success');
        generateMonthlyReport(newReport);
    } else {
        showToast(saveResult.error || 'msg_error', 'error');
    }
}

function generateMonthlyReport(report) {
    currentActiveReport = report;
    const detailScreen = document.getElementById('report-detail-screen');
    if (!detailScreen) return;

    document.getElementById('report-score').textContent = report.score;

    const statsContainer = document.getElementById('report-stats');
    statsContainer.innerHTML = `
        <div class="report-stat-item" style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span class="report-stat-label">${t('report_passwords_total') || 'Total Passwords'}:</span>
            <span class="report-stat-val" style="font-weight:bold;">${report.total}</span>
        </div>
        <div class="report-stat-item" style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span class="report-stat-label">${t('report_passwords_strong') || 'Strong Passwords'}:</span>
            <span class="report-stat-val text-success" style="font-weight:bold; color:#22c55e;">${report.strong}</span>
        </div>
        <div class="report-stat-item" style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span class="report-stat-label">${t('report_passwords_weak') || 'Weak Passwords'}:</span>
            <span class="report-stat-val text-warning" style="font-weight:bold; color:#ff8c00;">${report.weak}</span>
        </div>
        <div class="report-stat-item" style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span class="report-stat-label">${t('report_passwords_reused') || 'Reused Passwords'}:</span>
            <span class="report-stat-val text-danger" style="font-weight:bold; color:#e74c3c;">${report.reused}</span>
        </div>
    `;

    const recContainer = document.getElementById('report-recommendations');
    recContainer.innerHTML = '';
    
    let recommendations = [];
    if (report.weak > 0) {
        recommendations.push(`<div class="report-rec-item text-warning" style="color:#ff8c00; margin-top:8px;">⚠️ ${t('report_recommendation_weak', { count: report.weak }) || (report.weak + ' passwords should be changed.')}</div>`);
    }
    if (report.reused > 0) {
        recommendations.push(`<div class="report-rec-item text-danger" style="color:#e74c3c; margin-top:8px;">🔄 ${t('report_recommendation_reused', { count: report.reused }) || (report.reused + ' passwords are reused across accounts.')}</div>`);
    }
    if (report.weak === 0 && report.reused === 0) {
        recommendations.push(`<div class="report-rec-item text-success" style="color:#22c55e; margin-top:8px;">✅ ${t('report_recommendation_good') || 'Your passwords are in good shape!'}</div>`);
    }

    recContainer.innerHTML = recommendations.join('');
    showScreen('report-detail-screen');
}

async function handleDeleteReport() {
    if (!currentActiveReport) return;

    showConfirmationModal(
        'modal_delete_report_title',
        'modal_delete_report_desc',
        async () => {
            const idx = reports.findIndex(r => r.id === currentActiveReport.id);
            if (idx !== -1) {
                reports.splice(idx, 1);
                const saveResult = await window.api.saveReports({ password: currentPassword, reports });
                if (saveResult.success) {
                    showToast('report_deleted_success', 'success');
                    currentActiveReport = null;
                    showReportsScreen();
                } else {
                    showToast(saveResult.error || 'msg_error', 'error');
                }
            }
        }
    );
}

function showReportsScreen() {
    showScreen('reports-screen');
    updateSidebarActive('reports');
    renderReportsList();
}

function renderReportsList() {
    const container = document.getElementById('reports-list');
    if (!container) return;
    container.innerHTML = '';

    if (reports.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>${t('reports_empty') || 'No reports saved yet.'}</p>
                <p class="hint">${t('reports_hint') || 'Reports are automatically generated at the end of each month.'}</p>
            </div>
        `;
        return;
    }

    reports.forEach((report) => {
        const card = document.createElement('div');
        card.className = 'password-card';

        const reportDate = new Date(report.date);
        const localeStr = currentLanguage === 'de' ? 'de-DE' : currentLanguage === 'es' ? 'es-ES' : currentLanguage === 'fr' ? 'fr-FR' : 'en-US';
        const dateOptions = { year: 'numeric', month: 'long' };
        const formattedDate = reportDate.toLocaleDateString(localeStr, dateOptions);

        card.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                <span class="password-card-name" style="font-weight:bold;">${escapeHtml(formattedDate)}</span>
                <span style="font-size:12px; color:var(--color-text-muted);">${t('report_passwords_total') || 'Total Passwords'}: ${report.total}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge" style="background:#ff8c00; color:white; padding:2px 6px; border-radius:4px; font-size:11px;">${t('dashboard_score_label') || 'Score'}: ${report.score}</span>
                <span class="password-card-arrow">
                    <img src="../logos/right.png" alt=">">
                </span>
            </div>
        `;

        card.addEventListener('click', () => {
            generateMonthlyReport(report);
        });

        container.appendChild(card);
    });
}

function showTrashScreen() {
    showScreen('trash-screen');
    updateSidebarActive('trash');
    document.getElementById('trash-search-input').value = '';
    renderTrashList();
}

function renderTrashList() {
    const container = document.getElementById('trash-list');
    if (!container) return;
    container.innerHTML = '';

    const searchTerm = document.getElementById('trash-search-input').value.toLowerCase();
    const filtered = trash.filter(item => {
        const title = (item.app || item.name || '').toLowerCase();
        const subtitle = (item.username || item.cardNumber || item.number || item.description || '').toLowerCase();
        return title.includes(searchTerm) || subtitle.includes(searchTerm);
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>${t('trash_empty')}</p>
            </div>
        `;
        return;
    }

    filtered.forEach((item) => {
        const index = trash.indexOf(item);
        const deletedDate = new Date(item.deletedAt);
        const expiryDate = new Date(deletedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const timeDiff = expiryDate.getTime() - Date.now();
        const daysLeft = Math.max(0, Math.ceil(timeDiff / (24 * 60 * 60 * 1000)));

        const card = document.createElement('div');
        card.className = 'trash-card';
        
        const badgeClass = daysLeft <= 7 ? 'danger' : 'warn';

        let displayName = item.app || item.name || '';
        let displaySubtitle = item.username || '';
        let typeBadgeKey = 'nav_passwords';

        if (item.type === 'card') {
            const maskedNumber = item.cardNumber ? ('•••• ' + item.cardNumber.replace(/\s+/g, '').slice(-4)) : '';
            const brandLabel = item.brand ? item.brand.toUpperCase() : '';
            displaySubtitle = `${brandLabel} ${maskedNumber}`.trim();
            typeBadgeKey = 'nav_cards';
        } else if (item.type === 'id') {
            displaySubtitle = item.number || '';
            typeBadgeKey = 'nav_ids';
        } else if (item.type === 'document') {
            displaySubtitle = item.description || '';
            typeBadgeKey = 'nav_documents';
        }

        card.innerHTML = `
            <div class="trash-card-info" style="display:flex; flex-direction:column; gap:4px; flex:1;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="trash-card-name" style="font-weight:bold;">${escapeHtml(displayName)}</span>
                    <span class="badge" style="background:var(--color-border); color:var(--color-text-muted); padding:2px 6px; border-radius:4px; font-size:10px;">${t(typeBadgeKey)}</span>
                </div>
                <span class="trash-card-user" style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(displaySubtitle)}</span>
            </div>
            <div class="trash-card-actions" style="display:flex; align-items:center; gap:8px;">
                <span class="trash-days-badge ${badgeClass}">${t('trash_days_left', { days: daysLeft })}</span>
                <button class="button small secondary restore-btn">${t('trash_restore')}</button>
                <button class="button small danger delete-permanent-btn">${t('trash_delete_permanent')}</button>
            </div>
        `;

        card.querySelector('.restore-btn').addEventListener('click', () => {
            restoreFromTrash(index);
        });

        card.querySelector('.delete-permanent-btn').addEventListener('click', () => {
            showConfirmationModal(
                'trash_confirm_delete',
                '',
                async () => {
                    await permanentlyDelete(index);
                }
            );
        });

        container.appendChild(card);
    });
}

async function moveToTrash(index) {
    const pwd = passwords[index];
    if (!pwd) return;

    pwd.deletedAt = new Date().toISOString();
    trash.push(pwd);
    passwords.splice(index, 1);

    const result = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
    if (result.success) {
        showToast('msg_saved', 'success');
        showMainScreen();
    } else {
        showToast('msg_error', 'error');
    }
}

async function restoreFromTrash(index) {
    const item = trash[index];
    if (!item) return;

    const type = item.type;
    delete item.deletedAt;
    delete item.type;

    let result;
    if (type === 'card') {
        cards.push(item);
        trash.splice(index, 1);
        const saveCardsResult = await window.api.saveCards({ password: currentPassword, cards });
        const savePwdResult = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
        result = { success: saveCardsResult.success && savePwdResult.success };
    } else if (type === 'id') {
        ids.push(item);
        trash.splice(index, 1);
        const saveIdsResult = await window.api.saveIds({ password: currentPassword, ids });
        const savePwdResult = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
        result = { success: saveIdsResult.success && savePwdResult.success };
    } else if (type === 'document') {
        documents.push(item);
        trash.splice(index, 1);
        const saveDocsResult = await window.api.saveDocuments({ password: currentPassword, documents });
        const savePwdResult = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
        result = { success: saveDocsResult.success && savePwdResult.success };
    } else {
        passwords.push(item);
        trash.splice(index, 1);
        result = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
    }

    if (result.success) {
        showToast('trash_restored', 'success');
        renderTrashList();
    } else {
        showToast('msg_error', 'error');
    }
}

async function permanentlyDelete(index) {
    trash.splice(index, 1);

    const result = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
    if (result.success) {
        showToast('trash_deleted', 'success');
        renderTrashList();
    } else {
        showToast('msg_error', 'error');
    }
}

async function handleEmptyTrash() {
    showConfirmationModal(
        'trash_confirm_empty',
        '',
        async () => {
            trash = [];
            const result = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
            if (result.success) {
                showToast('trash_emptied', 'success');
                renderTrashList();
            } else {
                showToast('msg_error', 'error');
            }
        }
    );
}

async function purgeExpiredTrash() {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const initialLength = trash.length;

    trash = trash.filter(item => {
        const deletedDate = new Date(item.deletedAt);
        return (now - deletedDate.getTime()) < thirtyDaysMs;
    });

    if (trash.length !== initialLength && currentPassword) {
        await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
    }
}

function showIdsScreen() {
    currentEditIdIndex = null;
    showScreen('ids-screen');
    updateSidebarActive('ids');
    document.getElementById('ids-search-input').value = '';
    renderIdsList();
}

function renderIdsList() {
    const container = document.getElementById('ids-list');
    if (!container) return;
    container.innerHTML = '';

    const searchTerm = document.getElementById('ids-search-input').value.toLowerCase();
    const filtered = ids.filter(item => 
        item.name.toLowerCase().includes(searchTerm) || 
        (item.number && item.number.toLowerCase().includes(searchTerm))
    );

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p data-i18n="ids_empty">${t('ids_empty')}</p>
                <p class="hint" data-i18n="ids_hint">${t('ids_hint')}</p>
            </div>
        `;
        return;
    }

    filtered.forEach((idItem) => {
        const index = ids.indexOf(idItem);
        const card = document.createElement('div');
        card.className = 'password-card';
        
        let warningBadge = '';
        if (idItem.expiryDate) {
            const expiry = new Date(idItem.expiryDate);
            const today = new Date();
            expiry.setHours(0,0,0,0);
            today.setHours(0,0,0,0);
            const timeDiff = expiry.getTime() - today.getTime();
            const daysLeft = Math.ceil(timeDiff / (24 * 60 * 60 * 1000));
            
            if (daysLeft < 0) {
                warningBadge = `<span class="badge badge-danger" style="background:#e74c3c; color:white; padding:2px 6px; border-radius:4px; font-size:11px;">${t('id_expired')}</span>`;
            } else if (daysLeft <= 30) {
                warningBadge = `<span class="badge badge-warning" style="background:#ff8c00; color:white; padding:2px 6px; border-radius:4px; font-size:11px;">${t('id_expiring_soon', { days: daysLeft })}</span>`;
            } else {
                const localeStr = currentLanguage === 'de' ? 'de-DE' : currentLanguage === 'es' ? 'es-ES' : currentLanguage === 'fr' ? 'fr-FR' : 'en-US';
                warningBadge = `<span class="badge badge-success" style="background:#22c55e; color:white; padding:2px 6px; border-radius:4px; font-size:11px;">${expiry.toLocaleDateString(localeStr)}</span>`;
            }
        }

        const typeLabel = t(`id_type_${idItem.type.replace('drivers_license', 'drivers')}`) || idItem.type;

        card.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                <span class="password-card-name" style="font-weight:bold;">${escapeHtml(idItem.name)}</span>
                <span style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(typeLabel)} ${idItem.number ? '• ' + escapeHtml(idItem.number) : ''}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${warningBadge}
                <span class="password-card-arrow">
                    <img src="../logos/right.png" alt=">">
                </span>
            </div>
        `;

        card.addEventListener('click', () => {
            showEditId(index);
        });

        container.appendChild(card);
    });
}

function showAddId() {
    currentEditIdIndex = null;
    currentFiles = [];

    document.getElementById('edit-id-title').textContent = t('title_add') + ' ID';
    document.getElementById('edit-id-name').value = '';
    document.getElementById('edit-id-type').value = 'national_id';
    document.getElementById('edit-id-number').value = '';
    document.getElementById('edit-id-issue').value = '';
    document.getElementById('edit-id-expiry').value = '';
    document.getElementById('edit-id-notes').value = '';

    document.getElementById('delete-id-btn').classList.add('hidden');

    renderEditIdFileList();
    syncCustomSelect('edit-id-type');
    showScreen('edit-id-screen');
}

function showEditId(index) {
    currentEditIdIndex = index;
    const idItem = ids[index];

    currentFiles = idItem.files || [];

    document.getElementById('edit-id-title').textContent = t('btn_edit') + ' ID';
    document.getElementById('edit-id-name').value = idItem.name || '';
    document.getElementById('edit-id-type').value = idItem.type || 'national_id';
    document.getElementById('edit-id-number').value = idItem.number || '';
    document.getElementById('edit-id-issue').value = idItem.issueDate || '';
    document.getElementById('edit-id-expiry').value = idItem.expiryDate || '';
    document.getElementById('edit-id-notes').value = idItem.notes || '';

    document.getElementById('delete-id-btn').classList.remove('hidden');

    renderEditIdFileList();
    syncCustomSelect('edit-id-type');
    showScreen('edit-id-screen');
}

async function handleSaveId() {
    const name = document.getElementById('edit-id-name').value.trim();
    const type = document.getElementById('edit-id-type').value;
    const number = document.getElementById('edit-id-number').value.trim();
    const issueDate = document.getElementById('edit-id-issue').value;
    const expiryDate = document.getElementById('edit-id-expiry').value;
    const notes = document.getElementById('edit-id-notes').value.trim();

    if (!name) {
        showToast('msg_doc_name_required', 'error');
        return;
    }

    const idItem = {
        id: currentEditIdIndex !== null ? ids[currentEditIdIndex].id : generateId(),
        name,
        type,
        number,
        issueDate,
        expiryDate,
        notes,
        files: currentFiles
    };

    if (currentEditIdIndex !== null) {
        ids[currentEditIdIndex] = idItem;
    } else {
        ids.push(idItem);
    }

    const result = await window.api.saveIds({ password: currentPassword, ids });
    if (result.success) {
        showToast('id_saved', 'success');
        showIdsScreen();
    } else {
        showToast(result.error || 'msg_error', 'error');
    }
}

async function handleDeleteId() {
    if (currentEditIdIndex === null) return;
    
    showConfirmationModal(
        'modal_delete_id_title',
        'modal_delete_id_desc',
        async () => {
            const item = ids[currentEditIdIndex];
            item.type = 'id';
            item.deletedAt = new Date().toISOString();
            trash.push(item);
            ids.splice(currentEditIdIndex, 1);

            const resultIds = await window.api.saveIds({ password: currentPassword, ids });
            const resultPwd = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
            
            if (resultIds.success && resultPwd.success) {
                showToast('id_deleted', 'success');
                showIdsScreen();
            } else {
                showToast('msg_error', 'error');
            }
        }
    );
}

async function handleIdFileUpload() {
    if (currentFiles.length >= 5) {
        showToast('msg_max_files', 'error');
        return;
    }

    const { filePaths } = await window.api.showOpenDialog({
        title: 'Select Scan/Photo to Attach',
        properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
        const filePath = filePaths[0];
        const result = await window.api.readFile(filePath);

        if (result.success) {
            currentFiles.push({ data: result.data, name: result.fileName });
            renderEditIdFileList();
            showToast('msg_file_attached', 'success');
        } else {
            showToast(result.error || 'msg_file_read_error', 'error');
        }
    }
}

function renderEditIdFileList() {
    const container = document.getElementById('edit-id-file-list');
    const hint = document.getElementById('edit-id-file-hint');
    if (!container || !hint) return;
    container.innerHTML = '';

    if (currentFiles.length === 0) {
        hint.textContent = 'No files selected';
        hint.style.display = '';
        return;
    }

    hint.style.display = 'none';

    currentFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-list-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-item-name';
        nameSpan.textContent = file.name;

        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '8px';

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'file-download-btn';
        downloadBtn.type = 'button';
        downloadBtn.title = 'Download';
        downloadBtn.innerHTML = '<img src="../logos/download.png" style="width:14px;height:14px;" alt="D">';
        downloadBtn.addEventListener('click', () => handleIdFileDownloadByIndex(index));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'file-delete-btn';
        deleteBtn.type = 'button';
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Remove file';
        deleteBtn.addEventListener('click', () => {
            currentFiles.splice(index, 1);
            renderEditIdFileList();
        });

        actionsDiv.appendChild(downloadBtn);
        actionsDiv.appendChild(deleteBtn);
        item.appendChild(nameSpan);
        item.appendChild(actionsDiv);
        container.appendChild(item);
    });
}

async function handleIdFileDownloadByIndex(fileIndex) {
    const file = currentFiles[fileIndex];
    if (!file) return;

    const { filePath } = await window.api.showSaveDialog({
        title: 'Save Attached File',
        defaultPath: file.name
    });

    if (filePath) {
        const result = await window.api.writeFile({ filePath, data: file.data });
        if (result.success) {
            showToast('msg_file_saved', 'success');
        } else {
            showToast('msg_file_save_error', 'error');
        }
    }
}

function showDocumentsScreen() {
    currentEditDocIndex = null;
    showScreen('documents-screen');
    updateSidebarActive('documents');
    document.getElementById('docs-search-input').value = '';
    renderDocumentsList();
}

function renderDocumentsList() {
    const container = document.getElementById('documents-list');
    if (!container) return;
    container.innerHTML = '';

    const searchTerm = document.getElementById('docs-search-input').value.toLowerCase();
    const filtered = documents.filter(item => 
        item.name.toLowerCase().includes(searchTerm) || 
        (item.description && item.description.toLowerCase().includes(searchTerm))
    );

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p data-i18n="docs_empty">${t('docs_empty')}</p>
                <p class="hint" data-i18n="docs_hint">${t('docs_hint')}</p>
            </div>
        `;
        return;
    }

    filtered.forEach((doc) => {
        const index = documents.indexOf(doc);
        const card = document.createElement('div');
        card.className = 'password-card';

        let totalBytes = 0;
        if (doc.files) {
            doc.files.forEach(f => {
                const approxSize = f.data ? Math.round((f.data.length * 3) / 4) : 0;
                totalBytes += approxSize;
            });
        }
        const sizeStr = formatBytes(totalBytes);
        const fileCount = doc.files ? doc.files.length : 0;

        card.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                <span class="password-card-name" style="font-weight:bold;">${escapeHtml(doc.name)}</span>
                <span style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(doc.description || '')}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge badge-secondary" style="background:#555; color:white; padding:2px 6px; border-radius:4px; font-size:11px;">${fileCount} ${fileCount === 1 ? 'file' : 'files'} (${sizeStr})</span>
                <span class="password-card-arrow">
                    <img src="../logos/right.png" alt=">">
                </span>
            </div>
        `;

        card.addEventListener('click', () => {
            showEditDocument(index);
        });

        container.appendChild(card);
    });
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showAddDocument() {
    currentEditDocIndex = null;
    currentFiles = [];

    document.getElementById('edit-doc-title').textContent = t('title_add') + ' Document';
    document.getElementById('edit-doc-name').value = '';
    document.getElementById('edit-doc-description').value = '';

    document.getElementById('delete-doc-btn').classList.add('hidden');

    renderEditDocFileList();
    showScreen('edit-document-screen');
}

function showEditDocument(index) {
    currentEditDocIndex = index;
    const doc = documents[index];

    currentFiles = doc.files || [];

    document.getElementById('edit-doc-title').textContent = t('btn_edit') + ' Document';
    document.getElementById('edit-doc-name').value = doc.name || '';
    document.getElementById('edit-doc-description').value = doc.description || '';

    document.getElementById('delete-doc-btn').classList.remove('hidden');

    renderEditDocFileList();
    showScreen('edit-document-screen');
}

async function handleSaveDocument() {
    const name = document.getElementById('edit-doc-name').value.trim();
    const description = document.getElementById('edit-doc-description').value.trim();

    if (!name) {
        showToast('msg_doc_name_required', 'error');
        return;
    }

    const docItem = {
        id: currentEditDocIndex !== null ? documents[currentEditDocIndex].id : generateId(),
        name,
        description,
        uploadedAt: currentEditDocIndex !== null ? documents[currentEditDocIndex].uploadedAt : new Date().toISOString(),
        files: currentFiles
    };

    if (currentEditDocIndex !== null) {
        documents[currentEditDocIndex] = docItem;
    } else {
        documents.push(docItem);
    }

    const result = await window.api.saveDocuments({ password: currentPassword, documents });
    if (result.success) {
        showToast('doc_saved', 'success');
        showDocumentsScreen();
    } else {
        showToast(result.error || 'msg_error', 'error');
    }
}

async function handleDeleteDocument() {
    if (currentEditDocIndex === null) return;

    showConfirmationModal(
        'modal_delete_doc_title',
        'modal_delete_doc_desc',
        async () => {
            const item = documents[currentEditDocIndex];
            item.type = 'document';
            item.deletedAt = new Date().toISOString();
            trash.push(item);
            documents.splice(currentEditDocIndex, 1);

            const resultDocs = await window.api.saveDocuments({ password: currentPassword, documents });
            const resultPwd = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
            
            if (resultDocs.success && resultPwd.success) {
                showToast('doc_deleted', 'success');
                showDocumentsScreen();
            } else {
                showToast('msg_error', 'error');
            }
        }
    );
}

async function handleDocFileUpload() {
    const { filePaths } = await window.api.showOpenDialog({
        title: 'Select Document to Attach',
        properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
        const filePath = filePaths[0];
        const result = await window.api.readFile(filePath);

        if (result.success) {
            currentFiles.push({ data: result.data, name: result.fileName });
            renderEditDocFileList();
            showToast('msg_file_attached', 'success');
        } else {
            showToast(result.error || 'msg_file_read_error', 'error');
        }
    }
}

function renderEditDocFileList() {
    const container = document.getElementById('edit-doc-file-list');
    const hint = document.getElementById('edit-doc-file-hint');
    if (!container || !hint) return;
    container.innerHTML = '';

    if (currentFiles.length === 0) {
        hint.textContent = 'No files selected';
        hint.style.display = '';
        return;
    }

    hint.style.display = 'none';

    currentFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-list-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-item-name';
        nameSpan.textContent = file.name;

        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '8px';

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'file-download-btn';
        downloadBtn.type = 'button';
        downloadBtn.title = 'Download';
        downloadBtn.innerHTML = '<img src="../logos/download.png" style="width:14px;height:14px;" alt="D">';
        downloadBtn.addEventListener('click', () => handleDocFileDownloadByIndex(index));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'file-delete-btn';
        deleteBtn.type = 'button';
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Remove file';
        deleteBtn.addEventListener('click', () => {
            currentFiles.splice(index, 1);
            renderEditDocFileList();
        });

        actionsDiv.appendChild(downloadBtn);
        actionsDiv.appendChild(deleteBtn);
        item.appendChild(nameSpan);
        item.appendChild(actionsDiv);
        container.appendChild(item);
    });
}

async function handleDocFileDownloadByIndex(fileIndex) {
    const file = currentFiles[fileIndex];
    if (!file) return;

    const { filePath } = await window.api.showSaveDialog({
        title: 'Save Attached File',
        defaultPath: file.name
    });

    if (filePath) {
        const result = await window.api.writeFile({ filePath, data: file.data });
        if (result.success) {
            showToast('msg_file_saved', 'success');
        } else {
            showToast('msg_file_save_error', 'error');
        }
    }
}

function showCardsScreen() {
    currentEditCardIndex = null;
    showScreen('cards-screen');
    updateSidebarActive('cards');
    document.getElementById('cards-search-input').value = '';
    renderCardsList();
}

function renderCardsList() {
    const container = document.getElementById('cards-list');
    if (!container) return;
    container.innerHTML = '';

    const searchTerm = document.getElementById('cards-search-input').value.toLowerCase();
    const filtered = cards.filter(c => 
        c.name.toLowerCase().includes(searchTerm) || 
        (c.cardholderName && c.cardholderName.toLowerCase().includes(searchTerm)) ||
        (c.cardNumber && c.cardNumber.includes(searchTerm))
    );

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>${t('cards_empty') || 'No credit cards saved.'}</p>
                <p class="hint">${t('cards_hint') || 'Click + to save a credit card.'}</p>
            </div>
        `;
        return;
    }

    filtered.forEach((cardItem) => {
        const index = cards.indexOf(cardItem);
        const card = document.createElement('div');
        card.className = 'password-card';

        let maskedNumber = '';
        if (cardItem.cardNumber) {
            const clean = cardItem.cardNumber.replace(/\s+/g, '');
            if (clean.length > 4) {
                maskedNumber = '•••• ' + clean.slice(-4);
            } else {
                maskedNumber = clean;
            }
        }

        const expiryStr = (cardItem.expiryMonth && cardItem.expiryYear) 
            ? `${cardItem.expiryMonth.padStart(2, '0')}/${cardItem.expiryYear}` 
            : '';

        const brandLabel = cardItem.brand ? cardItem.brand.toUpperCase() : '';

        card.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                <span class="password-card-name" style="font-weight:bold;">${escapeHtml(cardItem.name)}</span>
                <span style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(brandLabel)} ${escapeHtml(maskedNumber)}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${expiryStr ? `<span class="badge badge-secondary" style="background:#555; color:white; padding:2px 6px; border-radius:4px; font-size:11px;">${expiryStr}</span>` : ''}
                <span class="password-card-arrow">
                    <img src="../logos/right.png" alt=">">
                </span>
            </div>
        `;

        card.addEventListener('click', () => {
            showEditCard(index);
        });

        container.appendChild(card);
    });
}

function showAddCard() {
    currentEditCardIndex = null;

    document.getElementById('edit-card-title').textContent = t('title_add_card') || 'Add Credit Card';
    document.getElementById('edit-card-name').value = '';
    document.getElementById('edit-cardholder').value = '';
    document.getElementById('edit-card-number').value = '';
    document.getElementById('edit-card-brand').value = 'visa';
    document.getElementById('edit-card-expiry-month').value = '';
    document.getElementById('edit-card-expiry-year').value = '';
    document.getElementById('edit-card-cvv').value = '';
    document.getElementById('edit-card-notes').value = '';

    document.getElementById('delete-card-btn').classList.add('hidden');

    syncCustomSelect('edit-card-brand');
    showScreen('edit-card-screen');
}

function showEditCard(index) {
    currentEditCardIndex = index;
    const cardItem = cards[index];

    document.getElementById('edit-card-title').textContent = t('title_edit_card') || 'Edit Credit Card';
    document.getElementById('edit-card-name').value = cardItem.name || '';
    document.getElementById('edit-cardholder').value = cardItem.cardholderName || '';
    document.getElementById('edit-card-number').value = cardItem.cardNumber || '';
    document.getElementById('edit-card-brand').value = cardItem.brand || 'visa';
    document.getElementById('edit-card-expiry-month').value = cardItem.expiryMonth || '';
    document.getElementById('edit-card-expiry-year').value = cardItem.expiryYear || '';
    document.getElementById('edit-card-cvv').value = cardItem.cvv || '';
    document.getElementById('edit-card-notes').value = cardItem.notes || '';

    document.getElementById('delete-card-btn').classList.remove('hidden');

    syncCustomSelect('edit-card-brand');
    showScreen('edit-card-screen');
}

async function handleSaveCard() {
    const name = document.getElementById('edit-card-name').value.trim();
    const cardholderName = document.getElementById('edit-cardholder').value.trim();
    const cardNumber = document.getElementById('edit-card-number').value.trim();
    const brand = document.getElementById('edit-card-brand').value;
    const expiryMonth = document.getElementById('edit-card-expiry-month').value.trim();
    const expiryYear = document.getElementById('edit-card-expiry-year').value.trim();
    const cvv = document.getElementById('edit-card-cvv').value.trim();
    const notes = document.getElementById('edit-card-notes').value.trim();

    if (!name) {
        showToast('card_name_required', 'error');
        return;
    }

    const cardItem = {
        id: currentEditCardIndex !== null ? cards[currentEditCardIndex].id : generateId(),
        name,
        cardholderName,
        cardNumber,
        brand,
        expiryMonth,
        expiryYear,
        cvv,
        notes
    };

    if (currentEditCardIndex !== null) {
        cards[currentEditCardIndex] = cardItem;
    } else {
        cards.push(cardItem);
    }

    const result = await window.api.saveCards({ password: currentPassword, cards });
    if (result.success) {
        showToast('card_saved', 'success');
        showCardsScreen();
    } else {
        showToast(result.error || 'msg_error', 'error');
    }
}

async function handleDeleteCard() {
    if (currentEditCardIndex === null) return;

    showConfirmationModal(
        'modal_delete_card_title',
        'modal_delete_card_desc',
        async () => {
            const item = cards[currentEditCardIndex];
            item.type = 'card';
            item.deletedAt = new Date().toISOString();
            trash.push(item);
            cards.splice(currentEditCardIndex, 1);

            const resultCards = await window.api.saveCards({ password: currentPassword, cards });
            const resultPwd = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
            
            if (resultCards.success && resultPwd.success) {
                showToast('card_deleted', 'success');
                showCardsScreen();
            } else {
                showToast('msg_error', 'error');
            }
        }
    );
}

function setupDragAndDrop() {
    const passwordsNavItem = document.querySelector('#sidebar .nav-item[data-nav="passwords"]');
    if (passwordsNavItem) {
        passwordsNavItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            passwordsNavItem.classList.add('drag-over');
        });
        passwordsNavItem.addEventListener('dragleave', () => {
            passwordsNavItem.classList.remove('drag-over');
        });
        passwordsNavItem.addEventListener('drop', async (e) => {
            e.preventDefault();
            passwordsNavItem.classList.remove('drag-over');
            const passwordIndex = parseInt(e.dataTransfer.getData('text/plain'));
            if (!isNaN(passwordIndex) && passwords[passwordIndex]) {
                const pwd = passwords[passwordIndex];
                if (pwd.folderId !== null) {
                    pwd.folderId = null;
                    const result = await window.api.savePasswords({ password: currentPassword, passwords, folders, trash });
                    if (result.success) {
                        showToast(t('msg_moved_to_root', { app: pwd.app }), 'success', true);
                        renderPasswordList();
                    } else {
                        showToast('msg_error', 'error');
                    }
                }
            }
        });
    }
}
