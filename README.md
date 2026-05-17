# PassSafer 🔒

**PassSafer** is an ultimate offline-first desktop password manager and encrypted file vault, designed to keep your credentials and files completely secure, private, and stored locally on your device. Zero cloud, zero subscriptions, zero compromises.

---

## 🚀 Key Features

*   **Zero-Knowledge Architecture:** Your master password, PIN, and data never leave your device.
*   **Military-Grade Encryption:** Data is securely encrypted locally using industry-standard **AES-256-GCM** encryption and **PBKDF2** key derivation.
*   **Dual-Authentication Security:** Robust startup and configuration access locked behind a combined Master Password and 6-digit PIN verification.
*   **Encrypted File Vault:** Attach and encrypt files (up to 100MB) directly inside your secure local password database.
*   **Automatic Clipboard Clearing:** Auto-clears sensitive data (usernames, passwords) from your clipboard after 30 seconds to prevent unauthorized access.
*   **CSPRNG Password Generator:** Generate highly secure, random passwords directly within the app.
*   **Easy Import & Export:** Seamless backup/restore via encrypted files and direct import from Google Chrome or Mozilla Firefox CSV exports.

---

## 💻 Installation & Usage

### Official Downloads
You can download the latest pre-compiled and signed binaries directly from our [Download Page](https://zyniotech.github.io/passsafer/download.html) or from the [GitHub Releases](https://github.com/zyniotech/passsafer/releases).

### Local Development Setup

To run and build the application from source code locally:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/zyniotech/passsafer.git
    cd passsafer/Electron
    ```

2.  **Install Dependencies:**
    Make sure you have [Node.js](https://nodejs.org/) installed, then run:
    ```bash
    npm install
    ```

3.  **Run Locally in Developer Mode:**
    ```bash
    npm run dev
    ```

4.  **Package the Application:**
    Build package installers for your operating system:
    ```bash
    # Windows
    npm run dist:win
    
    # macOS
    npm run dist:mac
    
    # Linux
    npm run dist:linux
    ```

---

## 📜 Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

### Build and Signing Origin
To guarantee the authenticity, safety, and integrity of PassSafer, only installer binaries built directly from this official GitHub repository on trusted GitHub Actions runner groups from protected branches (e.g., `main` or release tags) are submitted to SignPath for automatic signing. Individual local builds or builds from forks cannot be signed using the official SignPath Foundation certificate.

### Team Roles & Code Review Policy
As a dedicated solo-developer open-source project, the repository is maintained and reviewed under the following configuration:
*   **Authors:** zyniotech (https://github.com/zyniotech)
*   **Reviewers:** zyniotech (https://github.com/zyniotech)
*   **Release approver:** zyniotech (https://github.com/zyniotech)

All production releases and builds are automatically triggered, verified, and audited via public GitHub Actions logs to ensure full cryptographic transparency.

---

## ⚖️ License

This entire project is licensed under the **MIT License**. For more information, please read the included [LICENSE](LICENSE) file.
