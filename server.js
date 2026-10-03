require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

let firebaseEnabled = false;

try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({
            credential: cert(serviceAccount)
        });
        firebaseEnabled = true;
        console.log("🔒 Firebase Auth is ENABLED (via ENV variable).");
    } else if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        initializeApp({
            credential: cert(serviceAccount)
        });
        firebaseEnabled = true;
        console.log("🔒 Firebase Auth is ENABLED (via JSON file).");
    } else {
        console.warn("⚠️  No Firebase credentials found! Server running in Development Mode.");
    }
} catch (e) {
    console.error("Firebase init fallback error: ", e);
}

let pty;
try { pty = require('node-pty'); } catch (e) { console.error("Warning: node-pty not available.", e); }

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 1048576 }); // 1MB payload limit

app.use(express.static(path.join(__dirname, 'public')));

const isWindows = process.platform === 'win32';
const shell = isWindows ? 'cmd.exe' : 'bash';
const shellFlag = isWindows ? '/c' : '-c';
const exeExtension = isWindows ? '.exe' : '';

const RUNS_PER_DAY_LIMIT = 500;
const userUsage = new Map();

// Periodically clean up old rate limit records to prevent memory leaks
setInterval(() => {
    const today = new Date().toISOString().split('T')[0];
    for (const [email, record] of userUsage.entries()) {
        if (record.date !== today) {
            userUsage.delete(email);
        }
    }
}, 1000 * 60 * 60);

function checkRateLimit(email) {
    const today = new Date().toISOString().split('T')[0];
    let record = userUsage.get(email);
    if (!record || record.date !== today) record = { count: 0, date: today };
    if (record.count >= RUNS_PER_DAY_LIMIT) return false;
    record.count += 1;
    userUsage.set(email, record);
    return true;
}

wss.on('connection', (ws) => {
    let ptyProcess = null;
    let tempDir = null;
    let authenticatedEmail = firebaseEnabled ? null : 'dev-user@example.com';

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'auth') {
                if (!firebaseEnabled) {
                    ws.send(JSON.stringify({ type: 'auth_success', email: 'dev-user@example.com (Dev Mode)' }));
                    return;
                }
                try {
                    const decodedToken = await getAuth().verifyIdToken(data.token);
                    authenticatedEmail = decodedToken.email;
                    ws.send(JSON.stringify({ type: 'auth_success', email: authenticatedEmail }));
                } catch (err) {
                    ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid or expired Google Token. Try refreshing.' }));
                    ws.close();
                }
                return;
            }

            if (data.type === 'run') {
                if (ptyProcess) return;

                if (data.code && data.code.length > 500000) {
                    ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m[Security] Payload too large (limit is 500KB).\x1b[0m\r\n' }));
                    return;
                }

                if (!authenticatedEmail) {
                    ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m[Security] You must be logged in to execute code.\x1b[0m\r\n' }));
                    return;
                }
                if (!checkRateLimit(authenticatedEmail)) {
                    ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Quota Exceeded] Google Account ${authenticatedEmail} hit the 500 limit.\x1b[0m\r\n` }));
                    return;
                }

                const code = data.code;
                const { runCode } = require('./run_code');
                runCode(code, ws, data.cols, data.rows);
            } else if (data.type === 'input') {
                if (ws.activeProcess) ws.activeProcess.write(data.data);
            } else if (data.type === 'resize') {
                if (ws.activeProcess && ws.activeProcess.resize) ws.activeProcess.resize(data.cols, data.rows);
            } else if (data.type === 'stop') {
                if (ws.activeCleanup) ws.activeCleanup();
                ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Execution Force Stopped]\x1b[0m\r\n` }));
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        if (ws.activeCleanup) ws.activeCleanup();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n===========================================`);
    console.log(`🚀 Ucompiler Server Running on PORT ${PORT}`);
    console.log(`===========================================\n`);
});
