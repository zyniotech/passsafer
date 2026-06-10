# PassSafer 🔒

[![GitHub Release](https://img.shields.io/github/v/release/zyniotech/passsafer?color=orange&logo=github)](https://github.com/zyniotech/passsafer/releases)
[![License](https://img.shields.io/badge/license-Custom-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen)](#downloads)

**PassSafer** is a premium, offline-first desktop password manager and encrypted file vault. It is designed to keep your credentials, identities, credit cards, and sensitive files completely secure and stored locally on your device. Zero forced cloud syncs, zero compromises.

---

## ⚡ Try It Out For Free!

Get started with PassSafer in less than 2 minutes:

*   🚀 **[Register for a 1-Month Free Trial](https://zynio-tech.web.app/register)** - No credit card required.
*   💻 **[Download PassSafer for Desktop](https://zynio-tech.web.app/download)** - Available for Windows, macOS, and Linux.
*   💳 **[View Premium Plans & Lifetime Options](https://zynio-tech.web.app/pricing)** - Pay once, use forever across up to 100 devices.

---

## 🚀 Key Features

*   🔑 **Zero-Knowledge Architecture:** Your master password, PIN, and data never leave your device. All encryption and decryption processes run strictly client-side.
*   🛡️ **Premium Encryption:** Your vault is locked with industry-standard **AES-256-GCM** authenticated encryption and derived keys via **Scrypt** (upgraded from PBKDF2 for advanced brute-force protection).
*   🔐 **Dual-Factor Local Authentication:** App startup and settings pages are secured with a combination of a strong Master Password and a quick 6-digit PIN.
*   📁 **Encrypted File Vault:** Securely attach and encrypt files (up to 100MB per file) directly inside your secure local password database.
*   🌐 **Browser Companion Extension:** Automatically fill your logins and dynamically save/update logins directly to your local desktop vault via secure Chrome Native Messaging.
*   📋 **Clipboard Shield:** Automatically clears passwords and sensitive credentials from your system clipboard after 30 seconds to prevent clipboard hijacking.
*   🎲 **CSPRNG Password Generator:** Generate highly secure, randomized passwords using rejection-sampling to eliminate modulo bias.
*   📊 **Watchtower & Reports:** Run password audits to instantly find weak, reused, or compromised accounts, and generate monthly reports.
*   📥 **Import & Export:** Seamless backup/restore via encrypted files and direct import from Google Chrome or Mozilla Firefox CSV exports.

---

## 🛠️ Architecture Overview

PassSafer is built with security and portability in mind:

1.  **Electron Desktop Client:** Coordinates filesystem storage, local AES-256-GCM encryption, clipboard controls, and native system integration.
2.  **Browser Extension (Comming soon):** Connects to the desktop app via a native messaging bridge (`de.passsafer.helper.json`) to perform secure autofill without keeping plain-text keys in memory.
3.  **Cloudflare Worker API:** A serverless backend api handles PayPal checkouts, license generation, and monthly validation syncs.

---

## 💻 Local Development Setup

To run and build the application from source code locally:

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v18+) and `npm` installed.

### Setup Steps

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/zyniotech/passsafer.git
    cd passsafer
    ```

2.  **Install Electron App Dependencies:**
    ```bash
    cd Electron
    npm install
    ```

3.  **Run Locally in Developer Mode:**
    ```bash
    npm start
    ```

4.  **Package installer files:**
    Build installer packages for your target operating system:
    ```bash
    # Build for Windows installer (.exe)
    npm run dist:win
    
    # Build for macOS installer (.dmg)
    npm run dist:mac
    
    # Build for Linux installer (.AppImage)
    npm run dist:linux
    ```

---

## ⚖️ License

This project operates under a custom **PassSafer Open Source & Commercial License**. For details on usage rights, hosting, and commercial distribution, please read the included [LICENSE](LICENSE) file.
