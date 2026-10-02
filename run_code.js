const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.runCode = (code, ws, cols, rows) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucompiler-'));
    const isWindows = process.platform === 'win32';
    const exeExt = isWindows ? '.exe' : '';
    const sourceFile = path.join(tempDir, 'main.c');
    const stdBufFile = path.join(tempDir, 'stdbuf.c');
    const outputFile = path.join(tempDir, `prog${exeExt}`);

    fs.writeFileSync(sourceFile, code);
    fs.writeFileSync(stdBufFile, `#include <stdio.h>\nvoid __attribute__((constructor)) unbuffer_stdout(void) { setvbuf(stdout, NULL, _IONBF, 0); }`);



    const compile = cp.spawn('gcc', ['-O2', '-Wall', sourceFile, stdBufFile, '-o', outputFile]);
    let stderr = '';
    compile.stderr.on('data', d => { stderr += d.toString(); });
    compile.on('close', code => {
        if (code !== 0) {
            ws.send(JSON.stringify({ type: 'output', data: `${stderr.replace(/\n/g, '\r\n')}` }));
            fs.rmSync(tempDir, { recursive: true, force: true });
            return;
        }

        // Removed [Execution Started]

        let ptyProcess = null;
        let isDead = false;

        const timeoutKiller = setTimeout(() => {
            if (isDead) return;
            ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31mTimeout: Execution exceeded 15 seconds.\x1b[0m\r\n` }));
            cleanup();
        }, 15000);

        function cleanup() {
            if (isDead) return;
            isDead = true;
            clearTimeout(timeoutKiller);
            if (ptyProcess) {
                try { if (ptyProcess.killProc) ptyProcess.killProc(); else ptyProcess.kill(); } catch (e) {}
            }
            ws.activeProcess = null;
            ws.send(JSON.stringify({type: 'process_ended'}));
            if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {} }
        }

        try {
            // Because node-pty crashes with posix_spawnp on Mac Node 24, we fallback immediately if on Mac
            if (process.platform === 'darwin') {
                throw new Error("Force fallback for Mac");
            }
            const pty = require('node-pty');
            const shell = isWindows ? 'cmd.exe' : 'bash';
            const shellFlag = isWindows ? '/c' : '-c';
            const executablePath = isWindows ? outputFile : `"${outputFile}"`;
            
            ptyProcess = pty.spawn(shell, [shellFlag, executablePath], {
                name: 'xterm-color', cols: cols || 80, rows: rows || 24, cwd: tempDir, env: process.env
            });
            ptyProcess.onData(data => ws.send(JSON.stringify({ type: 'output', data })));
            ptyProcess.onExit(({ exitCode }) => {
                
                cleanup();
            });
        } catch (e) {
            // Fallback to child_process
            ptyProcess = cp.spawn(outputFile, [], { cwd: tempDir, env: process.env });
            ptyProcess.stdout.on('data', d => {
                ws.send(JSON.stringify({ type: 'output', data: d.toString().replace(/\n/g, '\r\n') }));
            });
            ptyProcess.stderr.on('data', d => {
                ws.send(JSON.stringify({ type: 'output', data: d.toString().replace(/\n/g, '\r\n') }));
            });
            ptyProcess.on('close', exitCode => {
                
                cleanup();
            });
            ptyProcess.on('error', err => {
                ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m[Execution Error] ${err.message}\x1b[0m\r\n` }));
                cleanup();
            });

            let lineBuffer = '';
            ptyProcess.write = (d) => {
                if (ptyProcess.stdin.destroyed || isDead) return;
                const str = d.toString();

                // Handle multiple characters (like pasting)
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
        ws.activeCleanup = cleanup;
    });
};
