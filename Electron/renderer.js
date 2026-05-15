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

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    const isFirstRun = await window.api.checkFirstRun();
    if (isFirstRun) {
        showScreen('register-screen');
    } else {
        showScreen('login-screen');
    }
    setupEventListeners();
    setupAutoLogout();
    setupCustomSelect(); // Initialize custom select listener
});

// Screen Management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

// Toast Notifications
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show';
    if (type === 'success') toast.classList.add('success');
    if (type === 'error') toast.classList.add('error');

    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hidden');
    }, 3000);
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
    document.getElementById('settings-btn').addEventListener('click', () => showScreen('settings-screen'));
    document.getElementById('add-password-btn').addEventListener('click', showAddPassword);
    document.getElementById('create-folder-btn').addEventListener('click', showCreateFolder);
    document.getElementById('back-btn').addEventListener('click', handleBackToRoot);
    document.getElementById('search-input').addEventListener('input', handleSearch);

    // Detail Screen
    document.getElementById('close-detail-btn').addEventListener('click', () => showMainScreen());
    document.getElementById('copy-username-btn').addEventListener('click', copyUsername);
    document.getElementById('copy-password-btn').addEventListener('click', copyPassword);
    document.getElementById('toggle-password-btn').addEventListener('click', togglePasswordVisibility);
    document.getElementById('save-folder-btn').addEventListener('click', savePasswordFolder);
    document.getElementById('edit-password-btn').addEventListener('click', editCurrentPassword);
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
            
            text.textContent = `New version available! (v${info.version})`;
            banner.classList.remove('hidden');
            downloadBtn.classList.remove('hidden');
            installBtn.classList.add('hidden');
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download';
        });

        window.api.onUpdateDownloaded(() => {
            const text = document.getElementById('update-text');
            const downloadBtn = document.getElementById('update-download-btn');
            const installBtn = document.getElementById('update-install-btn');
            
            text.textContent = 'Update downloaded and ready to install!';
            downloadBtn.classList.add('hidden');
            installBtn.classList.remove('hidden');
            showToast('Update downloaded!', 'success');
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

        // Load passwords
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
        const message = searchTerm ? 'No results found.' : 'No passwords saved.';
        container.innerHTML = `
            <div class="empty-state">
                <p>${message}</p>
                ${!searchTerm ? '<p class="hint">Click + to add a password.</p>' : ''}
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
        <button class="folder-card-edit" title="Edit">
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
    noFolderOption.textContent = 'No Folder';
    noFolderOption.addEventListener('click', () => {
        trigger.textContent = 'No Folder';
        hiddenInput.value = '';
        closeAllSelect(null);
    });
    optionsContainer.appendChild(noFolderOption);

    // Default state
    let foundCurrent = false;

    folders.forEach(folder => {
        const option = document.createElement('div');
        option.textContent = folder.name;

        if (pwd.folderId === folder.id) {
            trigger.textContent = folder.name;
            hiddenInput.value = folder.id;
            option.classList.add('same-as-selected');
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
        trigger.textContent = 'No Folder';
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
    showToast('✓ Username copied! (clears in 30s)', 'success');
    scheduleClipboardClear();
}

function copyPassword() {
    const pwdElement = document.getElementById('detail-password');
    const password = pwdElement.dataset.password;
    navigator.clipboard.writeText(password);
    showToast('✓ Password copied! (clears in 30s)', 'success');
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
        'Delete entry?',
        'Do you really want to delete this entry?',
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
    document.getElementById('edit-username').value = pwd.username || '';
    document.getElementById('edit-password').value = pwd.password || '';
    document.getElementById('edit-notes').value = pwd.notes || '';
    renderEditFileList();
    showScreen('edit-password-screen');
}

async function handleSavePassword() {
    const app = document.getElementById('edit-app').value;
    const username = document.getElementById('edit-username').value;
    const password = document.getElementById('edit-password').value;
    const notes = document.getElementById('edit-notes').value;

    if (!app) {
        showToast('Application name is required!', 'error');
        return;
    }

    const passwordData = {
        app,
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
        'Delete Folder?',
        'Do you really want to delete this folder? Passwords inside will be moved to root.',
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
        'Logout',
        'Do you really want to logout?',
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

function showConfirmationModal(title, description, onConfirm) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-desc').textContent = description;
    pendingConfirmAction = onConfirm;

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
