# PassSafer

[![GitHub Release](https://img.shields.io/github/v/release/zyniotech/passsafer?color=orange&logo=github)](https://github.com/zyniotech/passsafer/releases)
[![License](https://img.shields.io/badge/license-Custom-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen)](#downloads)

**PassSafer** is a premium, offline-first desktop password manager and encrypted file vault. It is designed to keep your credentials, identities, credit cards, and sensitive files completely secure. All data is stored locally on your device. There are no forced cloud syncs, ensuring total privacy.

---

## Try It Out For Free

Get started with PassSafer in less than two minutes:

*   **[Register for a 1-Month Free Trial](https://passsafer.com/register)**: No credit card required.
*   **[Download PassSafer for Desktop](https://passsafer.com/download)**: Available for Windows, macOS, and Linux.
*   **[View Premium Plans & Lifetime Options](https://passsafer.com/pricing)**: Pay once, use forever across up to 100 devices.

---

## Key Features

*   **Zero-Knowledge Architecture:** Your master password, PIN, and data never leave your device. All encryption and decryption processes happen on your computer.
*   **Premium Encryption:** Your vault is secured with industry-standard AES-256-GCM authenticated encryption. Keys are derived using Scrypt for advanced protection against brute-force attacks.
*   **Dual-Factor Local Authentication:** App startup and settings are protected by a combination of a strong Master Password and a quick 6-digit PIN.
*   **Encrypted File Vault:** Securely attach and encrypt files (up to 100MB per file) directly within your local password database.
*   **Browser Companion Extension:** Automatically fill and update your login details. It saves new credentials to your local desktop vault using secure Chrome Native Messaging.
*   **Clipboard Shield:** Automatically removes passwords and sensitive data from your system clipboard after 30 seconds to prevent unauthorized access.
*   **Secure Password Generator:** Create highly random, strong passwords without predictability.
*   **Watchtower & Reports:** Run security audits to find weak, reused, or compromised passwords. Generate detailed monthly reports.
*   **Import & Export:** Easily back up and restore your data using encrypted files. Directly import from Google Chrome or Mozilla Firefox CSV exports.

---

## Browser Companion Extension

Supercharge your workflow by integrating PassSafer directly into your web browser. Our companion extension seamlessly autofills your credentials and securely communicates with your local desktop vault without storing plain-text keys.

*   **[Download from Chrome Web Store](https://chromewebstore.google.com/detail/pgccapkkkbbfeoafdmjibnjkiplnnffn?utm_source=item-share-cb)**

---

## Architecture Overview

PassSafer is built for security and performance:

1.  **Electron Desktop Client:** Manages local file storage, AES-256-GCM encryption, clipboard controls, and system integration.
2.  **Browser Extension (Coming soon):** Connects to the desktop application via a native messaging bridge (`de.passsafer.helper.json`) for secure autofill, without storing plain-text keys in memory.
3.  **Cloudflare Worker API:** A serverless backend that handles PayPal transactions, license generation, and monthly validation syncs.

---

## Support

We are committed to providing exceptional support and comprehensive documentation for our users.

*   **Help Center:** Visit our [Support Center](https://passsafer.com/support) for guides, FAQs, and troubleshooting.
*   **Contact Us:** Reach out to our premium support team directly via email at support@passsafer.com for priority assistance.

---

## License

This project operates under a custom **PassSafer Transparent Source-Available & Commercial License**. For details on usage rights, hosting, and commercial distribution, please read the included [LICENSE](LICENSE) file.
