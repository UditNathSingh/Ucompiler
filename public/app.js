const codeEditor = document.getElementById('codeEditor');
const runButton = document.getElementById('runButton');
const stopButton = document.getElementById('stopButton');
const buttonText = document.getElementById('buttonText');
const clearButton = document.getElementById('clearButton');
const uploadButton = document.getElementById('uploadButton');
const fileUpload = document.getElementById('fileUpload');
const downloadButton = document.getElementById('downloadButton');
const terminalContainer = document.getElementById('terminal-container');
const authBtn = document.getElementById('authBtn');
const authText = document.getElementById('authText');

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

let authToken = null; 

const defaultCode = `#include <stdio.h>

int main() {
    char name[50];
    float basic_pwd, hra, ma, pf, da, net;

    printf("Enter Employee Name : ");
    fflush(stdout);
    scanf("%49s", name);

    printf("Enter Basic Salary : ");
    fflush(stdout);
    scanf("%f", &basic_pwd);

    hra = basic_pwd * 0.10;
    ma = basic_pwd * 0.10;
    pf = basic_pwd * 0.15;
    da = basic_pwd * 0.20;
    net = (basic_pwd + hra + ma + da) - pf;

    printf("\n==========================================\n\n");
    printf("          EMPLOYEE SALARY SLIP\n\n");
    printf("==========================================\n");
    printf("Employee Name : %s\n", name);
    printf("Basic Salary: %.2f\n", basic_pwd);
    printf("------------------------------------------\n");
    printf("HRA : %.2f\n", hra);
    printf("MA : %.2f\n", ma);
    printf("PF : %.2f\n", pf);
    printf("DA : %.2f\n", da);
    printf("------------------------------------------\n");
    printf("Net salary : %.2f\n", net);
    printf("==========================================\n");
    return 0;
}`;

codeEditor.value = defaultCode;

const term = new Terminal({
  cursorBlink: true,
  theme: { background: '#0D1117', foreground: '#E6EDF3', cursor: '#C9D1D9', green: '#3FB950', red: '#FF7B72', cyan: '#39C5CF', yellow: '#D29922' },
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

authBtn.addEventListener('click', async () => {
    try {
        
        
        // Trigger Google Login Popup
        const result = await firebase.auth().signInWithPopup(googleProvider);
        
        // Get the secure JSON Web Token
        authToken = await result.user.getIdToken();
        
        // Update UI
        authText.textContent = `Signed in as ${result.user.displayName.split(' ')[0]}`;
        authBtn.classList.replace('bg-white', 'bg-emerald-600');
        authBtn.classList.replace('hover:bg-slate-200', 'hover:bg-emerald-500');
        authBtn.classList.replace('text-slate-900', 'text-white');
        
        runButton.classList.remove('hidden');
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!runButton.disabled && authToken) runButton.click();
    return;
  }
  const start = this.selectionStart, end = this.selectionEnd, value = this.value;
  if (e.key === 'Tab') {
    e.preventDefault();
    this.value = value.substring(0, start) + '    ' + value.substring(end);
    this.selectionStart = this.selectionEnd = start + 4;
  }
  const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
  if (pairs[e.key]) {
    e.preventDefault();
    const closeChar = pairs[e.key];
    if (start !== end) {
      const selectedText = value.substring(start, end);
      this.value = value.substring(0, start) + e.key + selectedText + closeChar + value.substring(end);
      this.selectionStart = start + 1;
      this.selectionEnd = end + 1;
    } else {
      this.value = value.substring(0, start) + e.key + closeChar + value.substring(end);
      this.selectionStart = this.selectionEnd = start + 1;
    }
  }
  if (e.key === 'Backspace' && start === end && start > 0) {
    if (pairs[value.substring(start - 1, start)] === value.substring(start, start + 1)) {
      e.preventDefault();
      this.value = value.substring(0, start - 1) + value.substring(end + 1);
      this.selectionStart = this.selectionEnd = start - 1;
    }
  }
});

uploadButton.addEventListener('click', () => fileUpload.click());
fileUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => { codeEditor.value = e.target.result; term.writeln(`\r\n\x1b[32m✓ Loaded ${file.name}\x1b[0m`); };
  reader.readAsText(file);
});
downloadButton.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([codeEditor.value], { type: 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = 'main.c';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});
