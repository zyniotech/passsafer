#!/usr/bin/env node

const net = require('net');
const fs = require('fs');

const PIPE_NAME = '\\\\.\\pipe\\passsafer-ipc';

function sendMessage(msg) {
    const jsonStr = JSON.stringify(msg);
    const buffer = Buffer.alloc(4 + Buffer.byteLength(jsonStr, 'utf8'));
    buffer.writeUInt32LE(Buffer.byteLength(jsonStr, 'utf8'), 0);
    buffer.write(jsonStr, 4, 'utf8');
    process.stdout.write(buffer);
}

let stdinBuffer = Buffer.alloc(0);

process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
        stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
    }

    while (stdinBuffer.length >= 4) {
        const msgLen = stdinBuffer.readUInt32LE(0);
        if (stdinBuffer.length >= 4 + msgLen) {
            const msgStr = stdinBuffer.toString('utf8', 4, 4 + msgLen);
            stdinBuffer = stdinBuffer.slice(4 + msgLen);
            try {
                const msgObj = JSON.parse(msgStr);
                sendToElectron(msgObj);
            } catch (e) {

            }
        } else {
            break;
        }
    }
});

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

function autoLaunchApp() {
    try {

        const devElectronDir = path.join(__dirname, '..', 'Electron');
        if (fs.existsSync(devElectronDir)) {
            const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            spawn(cmd, ['start', '--', '--tray'], {
                cwd: devElectronDir,
                detached: true,
                stdio: 'ignore'
            }).unref();
            return;
        }

        const relativeInstalledPath = path.join(__dirname, '..', '..', 'PassSafer.exe');
        if (fs.existsSync(relativeInstalledPath)) {
            spawn(relativeInstalledPath, ['--tray'], {
                detached: true,
                stdio: 'ignore'
            }).unref();
            return;
        }

        if (process.platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
            const pathsToTry = [
                path.join(localAppData, 'Programs', 'passsafer-electron', 'PassSafer.exe'),
                path.join(localAppData, 'Programs', 'passsafer', 'PassSafer.exe')
            ];
            for (const p of pathsToTry) {
                if (fs.existsSync(p)) {
                    spawn(p, ['--tray'], {
                        detached: true,
                        stdio: 'ignore'
                    }).unref();
                    return;
                }
            }

            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            const pfPath = path.join(programFiles, 'PassSafer', 'PassSafer.exe');
            if (fs.existsSync(pfPath)) {
                spawn(pfPath, ['--tray'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
                return;
            }
        }

        else if (process.platform === 'darwin') {
            const macPath = '/Applications/PassSafer.app/Contents/MacOS/PassSafer';
            if (fs.existsSync(macPath)) {
                spawn(macPath, ['--tray'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
                return;
            }
        }
    } catch (e) {

    }
}

function getDataDir() {
    let appData;
    if (process.platform === 'win32') {
        appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
        appData = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
        appData = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    }
    return path.join(appData, 'PassSafer', 'PassSaferData');
}

function getIpcToken() {
    try {
        const tokenPath = path.join(getDataDir(), '.ipc_token');
        if (fs.existsSync(tokenPath)) {
            return fs.readFileSync(tokenPath, 'utf8').trim();
        }
    } catch (e) {

    }
    return null;
}

function sendToElectron(msgObj) {

    const token = getIpcToken();
    if (token) {
        msgObj._token = token;
    }

    const client = net.connect(PIPE_NAME, () => {
        client.write(JSON.stringify(msgObj) + '\n');
    });

    client.setTimeout(5000);

    client.on('timeout', () => {
        client.destroy();
        sendMessage({
            action: msgObj.action,
            success: false,
            error: 'Connection to Desktop App timed out.'
        });
    });

    let responseBuffer = '';
    client.on('data', (data) => {
        responseBuffer += data.toString();

        const lines = responseBuffer.split('\n');

        responseBuffer = lines.pop();
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const respObj = JSON.parse(line.trim());
                    sendMessage(respObj);
                } catch (e) {

                }
            }
        }
    });
    client.on('end', () => {

        if (responseBuffer.trim()) {
            try {
                const respObj = JSON.parse(responseBuffer.trim());
                sendMessage(respObj);
            } catch (e) {

            }
        }
        responseBuffer = '';
    });

    client.on('error', (err) => {
        autoLaunchApp();
        sendMessage({ action: msgObj.action, success: false, error: 'PassSafer Desktop App is not running. Starting in background...' });
    });
}
