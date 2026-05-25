// Global State
let currentUser = null;
let currentPassword = null;
let passwords = [];
let folders = [];
let currentFolder = null;
let currentEditIndex = null;
let currentEditFolder = null;
let currentFileData = null;
let currentFileName = null;
let currentFiles = []; // Array of {data, name}
let translations = {};
let currentLanguage = 'en';
const API_BASE_URL = 'https://passsafer-api.zyniotech.workers.dev';
let licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false } };

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Language
    const systemLang = navigator.language.split('-')[0];
    currentLanguage = (systemLang === 'de') ? 'de' : 'en';
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
    
    // Set language select value
    const langSelect = document.getElementById('language-select');
    if (langSelect) langSelect.value = currentLanguage;
});

// Screen Management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
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
        showToast('Password generator requires a Premium license.', 'warning', true);
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

// Event Listeners Setup
function setupEventListeners() {
    // Login/Register
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('show-register-btn').addEventListener('click', () => showScreen('register-screen'));
    document.getElementById('show-login-btn').addEventListener('click', () => showScreen('login-screen'));

    // Main Screen
    document.getElementById('settings-btn').addEventListener('click', showSettings);
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

    document.getElementById('show-csv-import-btn').addEventListener('click', () => {
        document.getElementById('csv-file-path').textContent = 'No file selected';
        document.getElementById('csv-file-path').dataset.path = '';
        showScreen('csv-import-screen');
    });

    document.getElementById('close-csv-import-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('cancel-csv-import-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('select-csv-file-btn').addEventListener('click', selectCsvFile);
    document.getElementById('do-csv-import-btn').addEventListener('click', handleCsvImport);

    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.addEventListener('change', async (e) => {
            currentLanguage = e.target.value;
            await loadTranslations(currentLanguage);
            showToast(currentLanguage === 'de' ? 'Sprache geändert' : 'Language changed', 'success');
        });
    }

    // Change PIN Screen
    document.getElementById('close-change-pin-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('save-new-pin-btn').addEventListener('click', handleChangePin);
    document.getElementById('cancel-change-pin-btn').addEventListener('click', () => showScreen('settings-screen'));

    document.getElementById('save-new-password-btn').addEventListener('click', handleChangePassword);
    document.getElementById('cancel-change-password-btn').addEventListener('click', () => showScreen('settings-screen'));

    // Generator
    const genBtn = document.getElementById('generate-password-btn');
    if (genBtn) {
        genBtn.addEventListener('click', generateStrongPassword);
    }

    // Export Screen
    document.getElementById('show-export-btn').addEventListener('click', () => {
        document.getElementById('export-password').value = '';
        showScreen('export-screen');
    });
    document.getElementById('close-export-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('cancel-export-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('do-export-btn').addEventListener('click', handleExport);

    // Delete Account Screen
    document.getElementById('delete-account-btn').addEventListener('click', () => {
        document.getElementById('delete-account-password').value = '';
        showScreen('delete-account-screen');
    });
    document.getElementById('close-delete-account-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('cancel-delete-account-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('confirm-delete-account-btn').addEventListener('click', handleDeleteAccount);

    // Import Screen
    document.getElementById('show-import-btn').addEventListener('click', () => {
        document.getElementById('import-password').value = '';
        document.getElementById('import-file-path').textContent = 'Keine Datei ausgewählt';
        document.getElementById('import-file-path').dataset.path = '';
        showScreen('import-screen');
    });
    document.getElementById('close-import-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('cancel-import-btn').addEventListener('click', () => showScreen('settings-screen'));
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
}

// Auto-Update Handler
function setupAutoUpdate() {
    if (window.api && window.api.onUpdateAvailable) {
        window.api.onUpdateAvailable((info) => {
            const banner = document.getElementById('update-banner');
            const text = document.getElementById('update-text');
            const downloadBtn = document.getElementById('update-download-btn');
            const installBtn = document.getElementById('update-install-btn');
            
            text.textContent = t('msg_new_version', { version: info.version }) || `Neue Version v${info.version} verfügbar!`;
            banner.classList.remove('hidden');
            downloadBtn.classList.remove('hidden');
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download';
            installBtn.classList.add('hidden');
        });

        if (window.api.onUpdateProgress) {
            window.api.onUpdateProgress((info) => {
                const text = document.getElementById('update-text');
                const downloadBtn = document.getElementById('update-download-btn');
                const percent = Math.round(info.percent || 0);
                text.textContent = `Lade herunter... ${percent}%`;
                downloadBtn.textContent = 'Downloading...';
                downloadBtn.disabled = true;
            });
        }

        window.api.onUpdateDownloaded(() => {
            const banner = document.getElementById('update-banner');
            const text = document.getElementById('update-text');
            const downloadBtn = document.getElementById('update-download-btn');
            const installBtn = document.getElementById('update-install-btn');
            
            text.textContent = 'Update ist bereit! Bitte starte die App neu.';
            banner.classList.remove('hidden');
            downloadBtn.classList.add('hidden');
            installBtn.classList.remove('hidden');
            installBtn.textContent = 'Jetzt neustarten';
            showToast('Update erfolgreich geladen!', 'success');
        });

        document.getElementById('update-download-btn').addEventListener('click', async (e) => {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = 'Downloading...';
            await window.api.downloadUpdate();
        });

        document.getElementById('update-install-btn').addEventListener('click', () => {
            window.api.installUpdate();
        });

        document.getElementById('update-dismiss-btn').addEventListener('click', () => {
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
        showToast('Please fill in all fields!', 'error');
        return;
    }

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
        showToast('PIN must be exactly 6 digits!', 'error');
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
            showMainScreen();
            showToast('Login successful!', 'success');
            resetLogoutTimer();
        } else {
            showToast('Error loading passwords!', 'error');
        }
    } else {
        showToast('Invalid credentials!', 'error');
    }
}

// Register Handler
async function handleRegister() {
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const passwordRepeat = document.getElementById('register-password-repeat').value;
    const pin = document.getElementById('register-pin').value;

    if (!username || !password || !passwordRepeat || !pin) {
        showToast('Please fill in all fields!', 'error');
        return;
    }

    if (!validateUsername(username)) {
        showToast('Username: 3-30 chars, letters/numbers/./_/- only', 'error');
        return;
    }

    if (!validatePassword(password)) {
        showToast('Password: 10+ chars, Upper/Lower/Digit/Special!', 'error');
        return;
    }

    if (password !== passwordRepeat) {
        showToast('Passwords do not match!', 'error');
        return;
    }

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
        showToast('PIN must be exactly 6 digits!', 'error');
        return;
    }

    const result = await window.api.register({ username, password, pin });

    if (result.success) {
        showToast('Account created! Please login.', 'success');
        showScreen('login-screen');
    } else {
        showToast('Registration failed!', 'error');
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

function createPasswordCard(pwd, index) {
    const card = document.createElement('div');
    card.className = 'password-card';
    card.innerHTML = `
        <span class="password-card-name">${escapeHtml(pwd.app)}</span>
        <span class="password-card-arrow">
            <img src="../logos/right.png" alt=">">
        </span>
    `;
    card.addEventListener('click', () => showPasswordDetail(index));
    return card;
}

function createFolderCard(folder) {
    const passwordCount = passwords.filter(p => p.folderId === folder.id).length;
    const card = document.createElement('div');
    card.className = 'folder-card';
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
        if (elmnt == y.length /* logic slightly wrong in strict sense but effectively works for single select in click outside */) {
            // logic to keep open if clicked inside ignored here since stopPropagation used on trigger
        }
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
function scheduleClipboardClear() {
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    clipboardClearTimer = setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => { });
    }, 30000); // 30 seconds
}

function copyUsername() {
    const username = document.getElementById('detail-username').textContent;
    navigator.clipboard.writeText(username);
    showToast('msg_copied', 'success');
    scheduleClipboardClear();
}

function copyLink() {
    const link = document.getElementById('detail-link').textContent;
    navigator.clipboard.writeText(link);
    showToast('msg_copied', 'success');
    scheduleClipboardClear();
}

function copyPassword() {
    const pwdElement = document.getElementById('detail-password');
    const password = pwdElement.dataset.password;
    navigator.clipboard.writeText(password);
    showToast('msg_copied', 'success');
    scheduleClipboardClear();
}

async function savePasswordFolder() {
    const folderId = document.getElementById('folder-select').value || null;
    passwords[currentEditIndex].folderId = folderId;

    const result = await window.api.savePasswords({
        password: currentPassword,
        passwords,
        folders
    });

    if (result.success) {
        showToast('Folder assignment saved!', 'success');
    } else {
        showToast('Error saving!', 'error');
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
            passwords.splice(currentEditIndex, 1);

            const result = await window.api.savePasswords({
                password: currentPassword,
                passwords,
                folders
            });

            if (result.success) {
                showToast('Password deleted!', 'success');
                showMainScreen();
            } else {
                showToast('Error deleting!', 'error');
            }
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
        showToast('Application name is required!', 'error');
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
        folders
    });

    if (result.success) {
        showToast('Entry saved!', 'success');
        showMainScreen();
    } else {
        showToast('Error saving!', 'error');
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
        showToast('Please enter a folder name!', 'error');
        return;
    }

    // Check for duplicate name
    if (folders.some(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== currentEditFolder?.id)) {
        showToast('A folder with this name already exists!', 'error');
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
        folders
    });

    if (result.success) {
        showToast(currentEditFolder ? 'Folder renamed!' : 'Folder created!', 'success');
        showMainScreen();
    } else {
        showToast('Fehler beim Speichern!', 'error');
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
                folders
            });

            if (result.success) {
                showToast('Folder deleted!', 'success');
                showMainScreen();
            } else {
                showToast('Fehler beim Löschen!', 'error');
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
        showToast('Bitte alle Felder ausfüllen!', 'error');
        return;
    }

    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
        showToast('New PIN must be exactly 6 digits!', 'error');
        return;
    }

    if (newPin !== newPinRepeat) {
        showToast('PINs do not match!', 'error');
        return;
    }

    const result = await window.api.changePin({
        currentPassword: masterPwd,
        currentPin,
        newPin
    });

    if (result.success) {
        showToast('PIN successfully changed!', 'success');
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
        showToast('Bitte alle Felder ausfüllen!', 'error');
        return;
    }

    if (!validatePassword(newPwd)) {
        showToast('Passwort: 10+ Zeichen, Groß/Klein/Ziffer/Sonder!', 'error');
        return;
    }

    if (newPwd !== newPwdRepeat) {
        showToast('Passwörter stimmen nicht überein!', 'error');
        return;
    }

    const result = await window.api.changePassword({
        currentPassword: currentPwd,
        currentPin: pin,
        newPassword: newPwd
    });

    if (result.success) {
        currentPassword = newPwd;
        showToast('Master Password successfully changed!', 'success');
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
        showToast('Please enter master password and PIN!', 'error');
        return;
    }

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
        showToast('PIN must be exactly 6 digits!', 'error');
        return;
    }

    const result = await window.api.deleteAccount({ password, pin });

    if (result.success) {
        showToast('Account deleted. Goodbye!', 'success');
        setTimeout(() => {
            // Force reload to reset state and show register screen
            location.reload();
        }, 2000);
    } else {
        showToast('Error: ' + (result.error || 'Deletion failed'), 'error');
    }
}

// Logout
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
    currentFolder = null;

    showToast('Successfully logged out!', 'success');
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
            showToast('Automatically logged out (Inactivity)', 'info');
            handleLogout(true);
        }
    }, LOGOUT_TIMEOUT);
}

// Export Handler
async function handleExport() {
    const exportPassword = document.getElementById('export-password').value;
    if (!exportPassword) {
        showToast('Please set an export password!', 'error');
        return;
    }

    // [MITTEL-03] Export-Passwort muss gleiche Anforderungen erfüllen
    if (!validatePassword(exportPassword)) {
        showToast('Export password: 10+ chars, Upper/Lower/Digit/Special!', 'error');
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
            folders
        };

        const result = await window.api.exportPasswords({
            password: exportPassword,
            filePath,
            data: exportData
        });

        if (result.success) {
            showToast(`Export erfolgreich!`, 'success');
            showScreen('settings-screen');
        } else {
            showToast('Export fehlgeschlagen: ' + result.error, 'error');
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
        showToast('Please select a file!', 'error');
        return;
    }

    if (!importPassword) {
        showToast('Please enter the import password!', 'error');
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
            // Simple duplicate check (app + username)
            const exists = passwords.some(p =>
                p.app === impPwd.app &&
                p.username === impPwd.username
            );

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

        // Save merged data
        const saveResult = await window.api.savePasswords({
            password: currentPassword,
            passwords,
            folders
        });

        if (saveResult.success) {
            showToast(`${addedCount} passwords imported successfully!`, 'success');
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
        showToast('Maximum 5 files allowed!', 'error');
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
            showToast('File attached!', 'success');
        } else {
            showToast(result.error || 'Error reading file!', 'error');
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
        showToast('File not found!', 'error');
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
            showToast('File saved!', 'success');
        } else {
            showToast('Error saving file!', 'error');
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
                
                text.textContent = msg;
                banner.classList.remove('hidden');
                downloadBtn.classList.remove('hidden');
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
                installBtn.classList.add('hidden');
                
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
        showToast('Please select a CSV file!', 'error');
        return;
    }

    try {
        const result = await window.api.readFile(filePath);
        if (!result.success) throw new Error(result.error);

        const content = atob(result.data);
        const rows = parseCSV(content);
        
        if (rows.length < 2) {
            showToast('CSV file seems empty or invalid.', 'error');
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
            showToast('No valid entries found in CSV.', 'error');
            return;
        }

        // Merge with existing
        let added = 0;
        importedData.forEach(imp => {
            const exists = passwords.some(p => p.app === imp.app && p.username === imp.username);
            if (!exists) {
                passwords.push(imp);
                added++;
            }
        });

        const saveResult = await window.api.savePasswords({
            password: currentPassword,
            passwords,
            folders
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
            licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false } };
            return false;
        }

        const cached = loadRes.license;
        const now = Date.now();
        const lastSync = cached.lastSync || 0;
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const isOfflineLimitExceeded = (now - lastSync) > thirtyDaysMs;

        const isOnline = navigator.onLine;

        if (isOnline && (forceSync || isOfflineLimitExceeded)) {
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
                        const updatedLicense = {
                            licenseKey: cached.licenseKey,
                            plan: data.plan,
                            features: data.features,
                            expiryDate: data.expiryDate,
                            lastSync: Date.now()
                        };
                        await window.api.saveLicense(updatedLicense);
                        licenseState = {
                            valid: true,
                            plan: data.plan,
                            features: data.features,
                            expiryDate: data.expiryDate,
                            lastSync: Date.now()
                        };
                        updateSettingsLicenseUI();
                        return true;
                    } else {
                        await window.api.deleteLicense();
                        licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false } };
                        updateSettingsLicenseUI();
                        return false;
                    }
                }
            } catch (fetchErr) {
                console.error('Failed to contact licensing server during sync:', fetchErr);
            }
        }

        if (isOfflineLimitExceeded) {
            licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false }, error: 'offline_sync_required' };
            updateSettingsLicenseUI();
            return false;
        }

        if (cached.expiryDate) {
            const expiry = new Date(cached.expiryDate);
            if (expiry.getTime() < now) {
                licenseState = { valid: false, plan: 'none', features: { passwordGenerator: false } };
                updateSettingsLicenseUI();
                return false;
            }
        }

        licenseState = {
            valid: true,
            plan: cached.plan,
            features: cached.features || { passwordGenerator: cached.plan === 'premium' },
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
            const licenseData = {
                licenseKey,
                plan: data.plan,
                features: data.features,
                expiryDate: data.expiryDate,
                lastSync: Date.now()
            };
            const saveRes = await window.api.saveLicense(licenseData);
            if (saveRes.success) {
                licenseState = {
                    valid: true,
                    plan: data.plan,
                    features: data.features,
                    expiryDate: data.expiryDate,
                    lastSync: Date.now()
                };
                errorEl.classList.add('hidden');
                showToast('License activated successfully!', 'success');
                
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
                errorEl.textContent = 'Device limit reached. Only 1 device is allowed for Free Trial, and up to 100 devices for Premium.';
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
// NATIVE MESSAGING IPC HANDLER (FROM CHROME EXTENSION)
// ═══════════════════════════════════════════════════════════════════════
if (window.api && window.api.onNativeRequest) {
    window.api.onNativeRequest(async ({ id, request }) => {
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
                showToast('Passwords synchronized from extension!', 'success');
            }
        }
    });
}
