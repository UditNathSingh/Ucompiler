const codeEditor = document.getElementById('codeEditor');
const lineNumbers = document.getElementById('lineNumbers');
const highlightingContent = document.getElementById('highlighting-content');
const highlightingLayer = document.getElementById('highlighting-layer');
const runButton = document.getElementById('runButton');
const stopButton = document.getElementById('stopButton');
const buttonText = document.getElementById('buttonText');
const clearButton = document.getElementById('clearButton');
const formatButton = document.getElementById('formatButton');
const uploadButton = document.getElementById('uploadButton');
const importDriveButton = document.getElementById('importDriveButton');
const driveModal = document.getElementById('driveModal');
const closeDriveModal = document.getElementById('closeDriveModal');
const driveFileList = document.getElementById('driveFileList');
const driveLoading = document.getElementById('driveLoading');
const fileUpload = document.getElementById('fileUpload');
const logoutBtn = document.getElementById('logoutBtn');
const terminalContainer = document.getElementById('terminal-container');
const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');
const fileNameDisplay = document.getElementById('fileNameDisplay');

// === DEPLOYMENT CONFIGURATION ===
// Set this to your Google Cloud Run deployment URL when deploying separate frontend/backend.
// Example: 'ucompiler-backend-xxxxx.a.run.app'
// Leave empty ('') to use the same host (perfect for local development)
const PRODUCTION_BACKEND_HOST = 'ucompiler.onrender.com';

// FIREBASE INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyB3TPHvIZwm6p810uqUTlv4uNVO_4UMxXo",
  authDomain: "ucompiler-98fca.firebaseapp.com",
  projectId: "ucompiler-98fca",
  storageBucket: "ucompiler-98fca.firebasestorage.app",
  messagingSenderId: "994373334762",
  appId: "1:994373334762:web:d26d598db1f61c9c140993"
};
firebase.initializeApp(firebaseConfig);
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

let authToken = null;
let googleDriveToken = sessionStorage.getItem('googleDriveToken') || null;

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        authToken = await user.getIdToken();
        authText.textContent = `Signed in as ${user.displayName ? user.displayName.split(' ')[0] : 'User'}`;
        authBtn.style.background = "var(--kimi-color-positive)"; authBtn.style.color = "white"; authBtn.style.borderColor = "var(--kimi-color-positive)";

        runButton.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        if (term.buffer.active.cursorX === 0 && term.buffer.active.cursorY === 0) {
            // Already clear, do nothing
        } else {
            term.clear();
        }
    } else {
        authToken = null;
        googleDriveToken = null;
        sessionStorage.removeItem('googleDriveToken');
        authText.textContent = 'Sign in with Google';
        authBtn.style.background = ""; authBtn.style.color = ""; authBtn.style.borderColor = "";
        runButton.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        term.writeln('\r\n\x1b[33m[LOCKED] Please sign in with Google to unlock compiling.\x1b[0m');
    }
  
});

const defaultCode = `#include <stdio.h>

int main() {
    printf("Welcome to Ucompiler \\n");
    printf("Made By UditNath Singh \\n");
    return 0;
}`;

codeEditor.value = defaultCode;

function updateHighlighting() {
    let text = codeEditor.value;
    if(text[text.length-1] === "\n") {
        text += " ";
    }

    if (window.Prism && Prism.languages.c) {
        // Reset visibility just in case it fell back previously
        codeEditor.style.color = "transparent";
        codeEditor.style.webkitTextFillColor = 'transparent';

        highlightingContent.textContent = text;
        Prism.highlightElement(highlightingContent);
    } else {
        // Fallback: make textarea visible again if Prism is blocked/failed
        codeEditor.style.color = "#4d4d4d";
        codeEditor.style.webkitTextFillColor = "#4d4d4d";
        highlightingContent.innerHTML = '';
    }
}

let currentLineCount = 0;
function updateLineNumbers() {
    const linesCount = codeEditor.value.split('\n').length;
    if (linesCount !== currentLineCount) {
        currentLineCount = linesCount;
        let numbersHtml = '';
        for (let i = 1; i <= linesCount; i++) {
            numbersHtml += i + '<br>';
        }
        lineNumbers.innerHTML = numbersHtml;
    }
}

function updateAll() {
    updateLineNumbers();
    updateHighlighting();
}

let updatePending = false;
function scheduleUpdate() {
    if (!updatePending) {
        updatePending = true;
        requestAnimationFrame(() => {
            updateAll();
            updatePending = false;
        });
    }
}

codeEditor.addEventListener('input', scheduleUpdate);

// Fast scrolling sync using requestAnimationFrame
let scrollPending = false;
codeEditor.addEventListener('scroll', () => {
    if (!scrollPending) {
        scrollPending = true;
        requestAnimationFrame(() => {
            lineNumbers.scrollTop = codeEditor.scrollTop;
            highlightingLayer.scrollTop = codeEditor.scrollTop;
            highlightingLayer.scrollLeft = codeEditor.scrollLeft;
            scrollPending = false;
        });
    }
});

// initial run
updateAll();
window.addEventListener('load', updateAll); // Ensure it runs after Prism CDNs load

const term = new Terminal({
  cursorBlink: true,
  theme: { 
    background: '#1a1b26', 
    foreground: '#a9b1d6', 
    cursor: '#c0caf5', 
    black: '#414868',
    red: '#f7768e', 
    green: '#9ece6a', 
    yellow: '#e0af68', 
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff', 
    white: '#a9b1d6'
  },
  fontFamily: '"JetBrains Mono", "Courier New", monospace',
  fontSize: 14,
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(terminalContainer);
fitAddon.fit();

window.addEventListener('resize', () => {
    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
});

term.writeln('\x1b[33m[LOCKED] Please sign in with Google to unlock compiling.\x1b[0m');

let ws = null;

function connectWebSocket() {
    return new Promise((resolve, reject) => {
        let wsUrl;
        if (PRODUCTION_BACKEND_HOST) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${protocol}//${PRODUCTION_BACKEND_HOST}`;
        } else {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${protocol}//${window.location.host}`;
        }
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: 'auth',
                token: authToken 
            }));
        };
        ws.onerror = (error) => reject(error);
        
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if(msg.type === 'auth_success') {
                resolve(msg.email);
            } else if (msg.type === 'auth_error') {
                term.writeln(`\r\n\x1b[31mAuth Failed: ${msg.message}\x1b[0m`);
                reject();
            } else if (msg.type === 'output') {
                term.write(msg.data);
            }
        };
        
        ws.onclose = () => { ws = null; resetUI(); };
    });
}

logoutBtn.addEventListener('click', async () => {
    try {
        await firebase.auth().signOut();
        term.clear();
        term.writeln('\x1b[33m[LOCKED] Please sign in with Google to unlock compiling.\x1b[0m');
    } catch (e) {
        console.error(e);
    }
});

authBtn.addEventListener('click', async () => {
    try {
        const result = await firebase.auth().signInWithPopup(googleProvider);
        authToken = await result.user.getIdToken();
        googleDriveToken = result.credential.accessToken;
        if (googleDriveToken) sessionStorage.setItem('googleDriveToken', googleDriveToken);

        authText.textContent = `Signed in as ${result.user.displayName.split(' ')[0]}`;
        authBtn.style.background = "var(--kimi-color-positive)"; authBtn.style.color = "white"; authBtn.style.borderColor = "var(--kimi-color-positive)";

        runButton.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        term.clear();
    } catch (error) {
        console.error("Firebase login error:", error);
        term.writeln(`\r\n\x1b[31mGoogle Sign-In failed or was cancelled.\x1b[0m`);
    }
});

term.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: data }));
});

clearButton.addEventListener('click', () => term.clear());

function resetUI() {
    runButton.disabled = false;
    runButton.classList.remove('hidden');
    stopButton.classList.add('hidden');
}

runButton.addEventListener('click', async () => {
  const userCode = codeEditor.value.trim();
  if (!userCode) return;
  
  term.clear();
  runButton.disabled = true;
  runButton.classList.add('hidden');
  stopButton.classList.remove('hidden');
  
  try {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
          if (firebase.auth().currentUser) {
              authToken = await firebase.auth().currentUser.getIdToken(true);
          }
          await connectWebSocket();
      }
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      ws.send(JSON.stringify({ type: 'run', code: userCode }));
  } catch (err) {
      term.writeln(`\r\n\x1b[31mConnection failed.\x1b[0m`);
      resetUI();
  }
});

stopButton.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
    resetUI();
});

// VS Code Editor features
codeEditor.addEventListener('keydown', function(e) {
  let needsUpdate = false;
  if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    formatButton.click();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!runButton.disabled && authToken) runButton.click();
    return;
  }
  const start = this.selectionStart, end = this.selectionEnd, value = this.value;
  if (e.key === 'Enter') {
    e.preventDefault();
    const currentLine = value.substring(0, start).split('\n').pop();
    const indentation = currentLine.match(/^\s*/)[0];
    let insertString = '\n' + indentation;

    // If we're hitting Enter between { and }
    if (value.substring(start - 1, start) === '{' && value.substring(start, start + 1) === '}') {
      const insideIndentation = insertString + '    ';
      const afterBracket = '\n' + indentation;
      needsUpdate = true;
    this.value = value.substring(0, start) + insideIndentation + afterBracket + value.substring(end);
      this.selectionStart = this.selectionEnd = start + insideIndentation.length;
      if (needsUpdate) scheduleUpdate();
      return;
    }

    if (value.substring(start - 1, start) === '{') {
      insertString += '    ';
    }

    needsUpdate = true;
    this.value = value.substring(0, start) + insertString + value.substring(end);
    this.selectionStart = this.selectionEnd = start + insertString.length;
    if (needsUpdate) scheduleUpdate();
      return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    needsUpdate = true;
    this.value = value.substring(0, start) + '    ' + value.substring(end);
    this.selectionStart = this.selectionEnd = start + 4;
  }
  const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
  // Skip over-typing closing brackets
  if (Object.values(pairs).includes(e.key) && value.substring(start, start + 1) === e.key) {
    e.preventDefault();
    this.selectionStart = this.selectionEnd = start + 1;
    return;
  }
  if (pairs[e.key]) {
    e.preventDefault();
    const closeChar = pairs[e.key];
    if (start !== end) {
      const selectedText = value.substring(start, end);
      needsUpdate = true;
    this.value = value.substring(0, start) + e.key + selectedText + closeChar + value.substring(end);
      this.selectionStart = start + 1;
      this.selectionEnd = end + 1;
    } else {
      needsUpdate = true;
    this.value = value.substring(0, start) + e.key + closeChar + value.substring(end);
      this.selectionStart = this.selectionEnd = start + 1;
    }
  }
  if (e.key === 'Backspace' && start === end && start > 0) {
    if (pairs[value.substring(start - 1, start)] === value.substring(start, start + 1)) {
      e.preventDefault();
      needsUpdate = true;
    this.value = value.substring(0, start - 1) + value.substring(end + 1);
      this.selectionStart = this.selectionEnd = start - 1;
    }
  }
  if (needsUpdate) scheduleUpdate();
});

async function ensureDriveToken() {
    if (googleDriveToken) return true;
    try {
        term.writeln(`\r\n\x1b[36mRequesting Google Drive permission...\x1b[0m`);
        const result = await firebase.auth().signInWithPopup(googleProvider);
        googleDriveToken = result.credential.accessToken;
        if (googleDriveToken) {
            sessionStorage.setItem('googleDriveToken', googleDriveToken);
            authToken = await result.user.getIdToken();
            term.writeln(`\x1b[32mDrive access granted!\x1b[0m`);
            return true;
        }
    } catch (e) {
        term.writeln(`\r\n\x1b[31mDrive Access Denied: \x1b[0m${e.message}`);
    }
    return false;
}

uploadButton.addEventListener('click', async () => {
    if (!await ensureDriveToken()) return;
    uploadButton.disabled = true;
    const originalText = uploadButton.innerHTML;
    uploadButton.innerHTML = 'Saving...';
    try {
        let saveName = fileNameDisplay.value.trim();
        if (!saveName.endsWith('.c') && !saveName.endsWith('.h') && !saveName.endsWith('.txt')) {
            saveName += '.c';
        }
        const metadata = {
            name: saveName || 'Ucompiler_Code_' + new Date().getTime() + '.c',
            mimeType: 'text/x-csrc'
        };
        const fileContent = codeEditor.value;

        // Generate dynamic boundary to prevent multipart boundary smuggling
        const boundary = '-------' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        const bodyContent = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: text/plain\r\n\r\n' +
            fileContent +
            close_delim;

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + googleDriveToken,
                'Content-Type': 'multipart/related; boundary=' + boundary
            },
            body: bodyContent
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        term.writeln(`\r\n\x1b[32m✓ Saved to Google Drive successfully! (File: ${metadata.name})\x1b[0m`);
    } catch (e) {
        if (e.message.includes('Invalid Credentials') || e.message.includes('Auth')) {
            googleDriveToken = null;
            sessionStorage.removeItem('googleDriveToken');
        }
        term.writeln(`\r\n\x1b[31mFailed to upload: ${e.message}\x1b[0m`);
    }
    uploadButton.disabled = false;
    uploadButton.innerHTML = originalText;
});

function formatCCode(code) {
    const lines = code.split('\n');
    let indentLevel = 0;
    const formatted = [];
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let trimmed = line.trim();
        if (!trimmed) {
            formatted.push('');
            continue;
        }

        if (inBlockComment) {
            formatted.push(line);
            if (trimmed.includes('*/')) inBlockComment = false;
            continue;
        }
        if (trimmed.startsWith('/*')) {
            formatted.push(trimmed);
            if (!trimmed.includes('*/')) inBlockComment = true;
            continue;
        }

        let stripped = trimmed
            .replace(/\\"/g, '')
            .replace(/".*?"/g, '')
            .replace(/'.*?'/g, '')
            .replace(/\/\/.*$/, '');

        let openBraces = 0, closeBraces = 0;
        for (let char of stripped) {
            if (char === '{') openBraces++;
            if (char === '}') closeBraces++;
        }

        if (stripped.startsWith('}')) {
            indentLevel = Math.max(0, indentLevel - 1);
            closeBraces--;
        }

        let currentIndent = trimmed.startsWith('#') ? '' : '    '.repeat(indentLevel);
        formatted.push(currentIndent + trimmed);

        indentLevel += openBraces;
        indentLevel -= closeBraces;
        indentLevel = Math.max(0, indentLevel);
    }

    return formatted.join('\n');
}

formatButton.addEventListener('click', () => {
    codeEditor.value = formatCCode(codeEditor.value);
    updateAll();
});

importDriveButton.addEventListener('click', async () => {
    if (!await ensureDriveToken()) return;

    driveModal.classList.remove('hidden');
    driveModal.style.display = 'flex';
    driveFileList.innerHTML = '';
    driveLoading.classList.remove('hidden');

    try {
        const q = "mimeType='text/x-csrc' or mimeType='text/plain'";
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,createdTime)`, {
            headers: { Authorization: 'Bearer ' + googleDriveToken }
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        driveLoading.classList.add('hidden');
        if (data.files.length === 0) {
            driveFileList.innerHTML = '<p style="color:#8a8a8a; text-align:center; padding:16px;">No previously saved files found.</p>';
            return;
        }

        data.files.forEach(f => {
            const safeName = f.name.replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match]));
            const div = document.createElement('div');
            div.className = 'drive-item';
            div.innerHTML = `
                <div style="display:flex; flex-direction:column; overflow:hidden;">
                    <span style="font-size:14px; font-weight:500; color:#1a1a1a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeName}</span>
                    <span style="font-size:12px; color:#8a8a8a;">${new Date(f.createdTime).toLocaleString()}</span>
                </div>
                <button class="uc-run load-btn" style="height:28px; padding:0 12px; font-size:12px; align-self:center;">Load</button>
            `;
            div.querySelector('.load-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                loadDriveFile(f.id, f.name);
            });
            div.addEventListener('click', () => loadDriveFile(f.id, f.name));
            driveFileList.appendChild(div);
        });
    } catch (e) {
        if (e.message.includes('Invalid Credentials') || e.message.includes('Auth')) {
            googleDriveToken = null;
            sessionStorage.removeItem('googleDriveToken');
        }
        driveLoading.classList.add('hidden');
        driveFileList.innerHTML = `<p style="color:#e53e3e; text-align:center; padding:16px;">Error loading files: ${e.message}</p>`;
    }
});

closeDriveModal.addEventListener('click', () => {
    driveModal.style.display = 'none';
});

async function loadDriveFile(id, name) {
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
            headers: { Authorization: 'Bearer ' + googleDriveToken }
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error.message);
        }
        let text = await res.text();
        text = text.replace(/\t/g, '    ').replace(/\r\n/g, '\n'); codeEditor.value = text;
        fileNameDisplay.value = name;
        updateAll();
        closeDriveModal.click();
        term.writeln(`\r\n\x1b[32m✓ Imported ${name} from Google Drive\x1b[0m`);
    } catch (e) {
        term.writeln(`\r\n\x1b[31mFailed to load file: ${e.message}\x1b[0m`);
    }
}


fileNameDisplay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        fileNameDisplay.blur();
    }
});

const renameFileBtn = document.getElementById('renameFileBtn');
if (renameFileBtn) {
    renameFileBtn.addEventListener('click', () => {
        fileNameDisplay.focus();
        fileNameDisplay.setSelectionRange(0, fileNameDisplay.value.lastIndexOf('.'));
    });
}


fileNameDisplay.addEventListener('blur', () => {
    let name = fileNameDisplay.value.trim();
    if (!name) name = "main.c";
    if (!name.includes('.')) name += '.c';
    fileNameDisplay.value = name;
});

codeEditor.addEventListener('paste', function(e) {
  e.preventDefault();
  let paste = (e.clipboardData || window.clipboardData).getData('text');
  // Strict standardization for horizontal text width match
  paste = paste.replace(/\t/g, '    ');
  paste = paste.replace(/\r\n/g, '\n');
  
  const start = this.selectionStart;
  const end = this.selectionEnd;
  needsUpdate = true;
    this.value = this.value.substring(0, start) + paste + this.value.substring(end);
  this.selectionStart = this.selectionEnd = start + paste.length;
  updateAll();
});
