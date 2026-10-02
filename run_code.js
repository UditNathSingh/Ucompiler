const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.runCode = (code, ws, cols, rows) => {
    // Security check: simple anti path-traversal for include
    if (code.match(/#include\s*["<]\s*(\.\.|\/)/)) {
        ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Security] Absolute or relative path includes are blocked.\x1b[0m\r\n` }));
        ws.send(JSON.stringify({type: 'process_ended'}));
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucompiler-'));
    const isWindows = process.platform === 'win32';
    const exeExt = isWindows ? '.exe' : '';
    const sourceFile = path.join(tempDir, 'main.c');
    const stdBufFile = path.join(tempDir, 'stdbuf.c');
    const outputFile = path.join(tempDir, `prog${exeExt}`);

    fs.writeFileSync(sourceFile, code);
    fs.writeFileSync(stdBufFile, `#include <stdio.h>\nvoid __attribute__((constructor)) unbuffer_stdout(void) { setvbuf(stdout, NULL, _IONBF, 0); }`);

    let isDead = false;
    let ptyProcess = null;
    let compileProcess = null;
    let timeoutKiller = null;

    function cleanup() {
        if (isDead) return;
        isDead = true;
        if (timeoutKiller) clearTimeout(timeoutKiller);
        if (compileProcess && !compileProcess.killed) { try { compileProcess.kill(); } catch (e) {} }
        if (ptyProcess) {
            try { if (ptyProcess.killProc) ptyProcess.killProc(); else ptyProcess.kill(); } catch (e) {}
        }
        ws.activeProcess = null;
        ws.send(JSON.stringify({type: 'process_ended'}));
        if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {} }
    }
    
    ws.activeCleanup = cleanup; // Setup immediately to catch premature disconnects

    // Dynamically inject library flags based on includes
    const compileArgs = ['-O2', '-Wall', sourceFile, stdBufFile, '-o', outputFile];

    if (code.includes('<math.h>')) compileArgs.push('-lm');
    if (code.includes('<pthread.h>')) compileArgs.push('-pthread');
    if (code.includes('<omp.h>')) compileArgs.push('-fopenmp');
    if (code.includes('<curl/curl.h>')) compileArgs.push('-lcurl');
    if (code.includes('<sqlite3.h>')) compileArgs.push('-lsqlite3');
    if (code.includes('<ncurses.h>')) compileArgs.push('-lncurses');
    if (code.includes('<cjson/cJSON.h>')) compileArgs.push('-lcjson');
    if (code.includes('<check.h>')) compileArgs.push('-lcheck');
    if (code.includes('<glib.h>')) compileArgs.push('-lglib-2.0');

    compileProcess = cp.spawn('gcc', compileArgs);
    let stderr = '';
    
    compileProcess.stderr.on('data', d => { stderr += d.toString(); });
    
    compileProcess.on('error', (err) => {
        if (isDead) return;
        ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Compiler Error] ${err.message}\x1b[0m\r\n` }));
        cleanup();
    });

    compileProcess.on('close', code => {
        if (isDead) return;
        
        if (code !== 0) {
            ws.send(JSON.stringify({ type: 'output', data: `${stderr.replace(/\n/g, '\r\n')}` }));
            cleanup();
            return;
        }

        timeoutKiller = setTimeout(() => {
            if (isDead) return;
            ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31mTimeout: Execution exceeded 15 seconds.\x1b[0m\r\n` }));
            cleanup();
        }, 15000);

        try {
            // Because node-pty crashes with posix_spawnp on Mac Node 24, we fallback immediately if on Mac
            if (process.platform === 'darwin') {
                throw new Error("Force fallback for Mac");
            }
            const pty = require('node-pty');
            const shell = isWindows ? 'cmd.exe' : 'bash';
            const shellFlag = isWindows ? '/c' : '-c';
            const executablePath = isWindows ? outputFile : `"${outputFile}"`;
            
            const secureEnv = { PATH: process.env.PATH, TERM: 'xterm-color' };
            ptyProcess = pty.spawn(shell, [shellFlag, executablePath], {
                name: 'xterm-color', cols: cols || 80, rows: rows || 24, cwd: tempDir, env: secureEnv
            });
            ptyProcess.onData(data => {
                if (!isDead) ws.send(JSON.stringify({ type: 'output', data }));
            });
            ptyProcess.onExit(({ exitCode }) => cleanup());
        } catch (e) {
            // Fallback to child_process
            const secureEnv = { PATH: process.env.PATH };
            ptyProcess = cp.spawn(outputFile, [], { cwd: tempDir, env: secureEnv });
            
            ptyProcess.stdout.on('data', d => {
                if (!isDead) ws.send(JSON.stringify({ type: 'output', data: d.toString().replace(/\n/g, '\r\n') }));
            });
            
            ptyProcess.stderr.on('data', d => {
                if (!isDead) ws.send(JSON.stringify({ type: 'output', data: d.toString().replace(/\n/g, '\r\n') }));
            });
            
            ptyProcess.on('close', exitCode => cleanup());
            
            ptyProcess.on('error', err => {
                if (!isDead) ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Execution Error] ${err.message}\x1b[0m\r\n` }));
                cleanup();
            });

            let lineBuffer = '';
            ptyProcess.write = (d) => {
                if (ptyProcess.stdin.destroyed || isDead) return;
                const str = d.toString();

                for (let i = 0; i < str.length; i++) {
                    const char = str[i];
                    if (char === '\r' || char === '\n') {
                        ws.send(JSON.stringify({ type: 'output', data: '\r\n' }));
                        ptyProcess.stdin.write(lineBuffer + '\n');
                        lineBuffer = '';
                    } else if (char === '\x7f' || char === '\b') {
                        if (lineBuffer.length > 0) {
                            lineBuffer = lineBuffer.slice(0, -1);
                            ws.send(JSON.stringify({ type: 'output', data: '\b \b' }));
                        }
                    } else {
                        lineBuffer += char;
                        ws.send(JSON.stringify({ type: 'output', data: char }));
                    }
                }
            };
            ptyProcess.resize = () => {};
            ptyProcess.killProc = () => ptyProcess.kill();
        }

        ws.activeProcess = ptyProcess;
    });
};
