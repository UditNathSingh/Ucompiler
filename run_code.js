const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.runCode = (code, ws, cols, rows) => {
    // Security check: Normalize C preprocessor tricks (line continuations and comments)
    let preprocessedCode = code.replace(/\\\r?\n/g, ''); // strip backslash continuations
    preprocessedCode = preprocessedCode.replace(/\/\*[\s\S]*?\*\//g, ' '); // remove block comments
    preprocessedCode = preprocessedCode.replace(/\/\/.*$/gm, ' '); // remove line comments

    // Block path traversal and absolute paths (prevent /etc/passwd reading via gcc error logs)
    if (preprocessedCode.match(/#\s*(include|import|include_next)\s*["<]\s*(\.\.|\/)/)) {
        ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Security] Absolute or relative path includes are blocked.\x1b[0m\r\n` }));
        ws.send(JSON.stringify({type: 'process_ended'}));
        ws.isRunning = false;
        return;
    }

    // Friendly fallback for common unsupported libraries (Windows/DOS specific or GUI)
    const incompatibleLibs = ['windows.h', 'conio.h', 'graphics.h', 'dos.h', 'bios.h', 'dir.h', 'mmsystem.h', 'x11/xlib.h'];
    const includeRegex = /#\s*(?:include|import|include_next)\s*[<"]([^>"]+)[>"]/g;
    let match;
    while ((match = includeRegex.exec(preprocessedCode)) !== null) {
        const lib = match[1].toLowerCase();
        if (incompatibleLibs.includes(lib)) {
            ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[33m[Compatibility Error] The library <${match[1]}> is not compatible with Ucompiler's Linux-based runtime environment.\x1b[0m\r\n` }));
            ws.send(JSON.stringify({type: 'process_ended'}));
            ws.isRunning = false;
            return;
        }
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
        ws.isRunning = false;
        ws.send(JSON.stringify({type: 'process_ended'}));
        if (tempDir) {
            // Delay deletion by 500ms to allow OS to release file locks (especially crucial on Windows)
            setTimeout(() => {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
            }, 500);
        }
    }
    
    ws.activeCleanup = cleanup; // Setup immediately to catch premature disconnects

    // Dynamically inject library flags and security hardening flags
    const compileArgs = [
        '-O2',
        '-Wall',
        '-Wextra',
        '-Wformat',
        '-Werror=format-security',
        '-fstack-protector-strong',
        '-D_FORTIFY_SOURCE=2',
        '-fPIE',
        sourceFile,
        stdBufFile,
        '-o',
        outputFile
    ];

    // Some security linker flags are Linux-specific (GNU ld) and fail on macOS (Apple Clang)
    if (process.platform !== 'darwin') {
        compileArgs.splice(compileArgs.indexOf(sourceFile), 0, '-pie', '-Wl,-z,relro', '-Wl,-z,now');
    }

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
    
    // Add compilation timeout to prevent #include </dev/random> or recursive macro bombs
    let compileKiller = setTimeout(() => {
        if (!isDead) {
            ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m[Compiler Error] Compilation exceeded 15 seconds. Terminated.\x1b[0m\r\n' }));
            cleanup();
        }
    }, 15000);

    compileProcess.stderr.on('data', d => { stderr += d.toString(); });
    
    compileProcess.on('error', (err) => {
        if (isDead) return;
        ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Compiler Error] ${err.message}\x1b[0m\r\n` }));
        cleanup();
    });

    compileProcess.on('close', code => {
        clearTimeout(compileKiller);
        if (isDead) return;
        
        if (code !== 0) {
            ws.send(JSON.stringify({ type: 'output', data: `${stderr.replace(/\n/g, '\r\n')}` }));
            cleanup();
            return;
        }

        timeoutKiller = setTimeout(() => {
            if (isDead) return;
            ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31mTimeout: Execution exceeded 60 seconds.\x1b[0m\r\n` }));
            cleanup();
        }, 60000);

        try {
            // Because node-pty crashes with posix_spawnp on Mac Node 24, we fallback immediately if on Mac
            if (process.platform === 'darwin') {
                throw new Error("Force fallback for Mac");
            }
            const pty = require('node-pty');
            const shell = isWindows ? 'cmd.exe' : 'bash';
            const shellFlag = isWindows ? '/c' : '-c';
            const isLinux = process.platform === 'linux';
            
            // Limit memory to 256MB and created files to 10MB to prevent DoS, if on Linux
            let executablePath = `"${outputFile}"`;
            if (isLinux) {
                executablePath = `ulimit -v 256000 -f 10000 && "${outputFile}"`;
            }

            const secureEnv = { PATH: process.env.PATH, TERM: 'xterm-color' };
            ptyProcess = pty.spawn(shell, [shellFlag, executablePath], {
                name: 'xterm-color', cols: cols || 80, rows: rows || 24, cwd: tempDir, env: secureEnv
            });
            
            let totalOutput = 0;
            const MAX_OUTPUT = 2 * 1024 * 1024; // 2MB max output
            
            ptyProcess.onData(data => {
                if (isDead) return;
                totalOutput += data.length;
                if (totalOutput > MAX_OUTPUT) {
                    ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m[Security] Output Limit Exceeded (2MB). Possible infinite print loop.\x1b[0m\r\n' }));
                    cleanup();
                    return;
                }
                ws.send(JSON.stringify({ type: 'output', data }));
            });
            ptyProcess.onExit(({ exitCode }) => cleanup());
        } catch (e) {
            // Fallback to child_process
            const secureEnv = { PATH: process.env.PATH };
            ptyProcess = cp.spawn(outputFile, [], { cwd: tempDir, env: secureEnv });
            
            let totalOutputCP = 0;
            const MAX_OUTPUT_CP = 2 * 1024 * 1024;
            
            ptyProcess.stdout.on('data', d => {
                if (isDead) return;
                totalOutputCP += d.length;
                if (totalOutputCP > MAX_OUTPUT_CP) {
                    ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m[Security] Output Limit Exceeded (2MB). Possible infinite print loop.\x1b[0m\r\n' }));
                    cleanup();
                    return;
                }
                ws.send(JSON.stringify({ type: 'output', data: d.toString().replace(/\n/g, '\r\n') }));
            });
            
            ptyProcess.stderr.on('data', d => {
                if (isDead) return;
                ws.send(JSON.stringify({ type: 'output', data: d.toString().replace(/\n/g, '\r\n') }));
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
                    } else if (char === '\x03') {
                        ws.send(JSON.stringify({ type: 'output', data: '^C\r\n' }));
                        cleanup();
                        return;
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
