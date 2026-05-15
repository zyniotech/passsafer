<div align="center">
  <h1>PassSafer – The Ultimate Offline Password Manager</h1>
  <p><strong>Your Digital Vault. Offline. Secure. Yours.</strong></p>
  
  [![Version](https://img.shields.io/badge/version-1.6.0-blue.svg)](https://github.com/zyniotech/passsafer/releases/latest)
</div>

---

## 🔒 Source-Available for Maximum Transparency

When it comes to security, there should be no secrets. **PassSafer** is a commercial offline password manager that relies 100% on local data storage.

To justify the trust of our users, we are making the critical **core source code (backend & cryptography)** available here for public inspection (Security Auditing) under a "Source-Available" model.

We have nothing to hide. Security experts and interested users can trace the exact path of their data here—from input to encryption on the hard drive.

### What is included in this repository?
This repository contains **exclusively** the backend logic and the communication bridge of the Electron application to make our encryption mechanisms transparent:

*   `main.js`: The main process. This is where the core logic happens. Here you will find our AES-256-GCM encryption, the PBKDF2 key derivation, secure local file storage, and the IPC handlers.
*   `preload.js`: The secure communication bridge (Context Isolation) between the user interface and the main process.

*Note: The code for the frontend (UI/UX) is not included here to protect our proprietary design.*

## 🚀 Get PassSafer 1.6.0 Today!
Take full control of your digital security. No subscriptions, no cloud leaks.

### [👉 Visit Our Website to Get Started](https://passsafer.com)

### Features of the full version:
- **Zero-Knowledge Architecture (Offline-First)**
- **AES-256-GCM Encryption**
- **Encrypted file attachments up to 100MB**
- **Beautiful & Modern Dark Mode UI**
- **CSPRNG Password Generator & Auto-Logout**
- **Encrypted Export & Backup features**
- **Automatic Seamless Updates**

## ⚖️ Licensing & Copyright
**IMPORTANT:** This repository is **not** under an Open Source license (like MIT/GPL).

The source code is provided here **exclusively for transparency and auditing purposes**. Copying, modifying, compiling, reselling, or any kind of commercial or non-commercial redistribution is strictly prohibited. It is **"All Rights Reserved"** by Zynio Tech.

Please read the included `LICENSE.txt` for the full legal terms.
