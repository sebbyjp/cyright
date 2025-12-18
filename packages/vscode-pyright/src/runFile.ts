import * as path from 'path';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';

type CyrightConfig = {
    pythonPath?: string;
    compileArgs?: string[];
    entryFunc?: string;
};

const out = vscode.window.createOutputChannel('Cyright');
const log = (s: string) => out.appendLine(s);

function execLogged(cmd: string, args: string[], options: cp.SpawnOptionsWithoutStdio): Promise<void> {
    return new Promise((resolve, reject) => {
        log(`$ ${cmd} ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
        const child = cp.spawn(cmd, args, { ...options, stdio: 'pipe', shell: false });
        child.stdout?.on('data', (d) => out.append(d.toString()));
        child.stderr?.on('data', (d) => out.append(d.toString()));
        child.on('error', (err) => {
            out.show(true);
            reject(err);
        });
        child.on('exit', (code, signal) => {
            if (code === 0) resolve();
            else {
                out.show(true);
                reject(new Error(`${cmd} ${args.join(' ')} -> ${code ?? signal}`));
            }
        });
    });
}

function getFolderFor(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
}

function stripTomlComments(line: string): string {
    let inStr = false;
    let quote: string | null = null;
    let outS = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (!inStr && ch === '#') break;
        if (!inStr && (ch === '"' || ch === "'")) {
            inStr = true;
            quote = ch;
            outS += ch;
            continue;
        }
        if (inStr && ch === quote) {
            inStr = false;
            quote = null;
            outS += ch;
            continue;
        }
        outS += ch;
    }
    return outS.trim();
}

function parseSimpleTomlCyright(raw: string): CyrightConfig {
    const lines = String(raw).split(/\r?\n/);
    let inCyright = false;
    const cfg: any = {};
    for (const rawLine of lines) {
        const line = stripTomlComments(rawLine);
        if (!line) continue;
        if (/^\s*\[\s*tool\.cyright\s*\]/.test(line)) {
            inCyright = true;
            continue;
        }
        if (/^\s*\[.*\]/.test(line)) {
            inCyright = false;
        }
        if (!inCyright) continue;
        const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
        if (!m) continue;
        const key = m[1];
        const val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            cfg[key] = val.slice(1, -1);
        } else if (val.startsWith('[') && val.endsWith(']')) {
            const inner = val.slice(1, -1).trim();
            if (!inner) cfg[key] = [];
            else {
                const parts: string[] = [];
                let acc = '';
                let inStr2 = false;
                let q: string | null = null;
                for (let i = 0; i < inner.length; i++) {
                    const ch = inner[i];
                    if (!inStr2 && ch === ',') {
                        parts.push(acc.trim());
                        acc = '';
                        continue;
                    }
                    if (!inStr2 && (ch === '"' || ch === "'")) {
                        inStr2 = true;
                        q = ch;
                        acc += ch;
                        continue;
                    }
                    if (inStr2 && ch === q) {
                        inStr2 = false;
                        q = null;
                        acc += ch;
                        continue;
                    }
                    acc += ch;
                }
                if (acc.trim()) parts.push(acc.trim());
                cfg[key] = parts.map((p) => {
                    const s = p.trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
                    return s;
                });
            }
        }
    }
    return cfg as CyrightConfig;
}

async function loadCyrightConfig(folder: vscode.WorkspaceFolder): Promise<CyrightConfig> {
    const pyproject = path.join(folder.uri.fsPath, 'pyproject.toml');
    try {
        const raw = await fs.promises.readFile(pyproject, 'utf8');
        return parseSimpleTomlCyright(raw) || {};
    } catch {
        return {};
    }
}

function normalizeCompileArgs(cfg: CyrightConfig): string[] {
    const base = Array.isArray(cfg.compileArgs) ? cfg.compileArgs.slice() : ['-i', '-3'];
    if (!base.includes('-i')) base.push('-i');
    return base;
}

function buildCythonizeArgs(file: vscode.Uri, cfg: CyrightConfig): string[] {
    const extra = normalizeCompileArgs(cfg);
    return ['-m', 'Cython.Build.Cythonize', ...extra, file.fsPath];
}

async function resolvePython(folder: vscode.WorkspaceFolder, cfg: CyrightConfig): Promise<string> {
    if (cfg.pythonPath) {
        const p = path.isAbsolute(cfg.pythonPath) ? cfg.pythonPath : path.join(folder.uri.fsPath, cfg.pythonPath);
        try {
            fs.accessSync(p);
            return p;
        } catch {
            throw new Error(`Configured [tool.cyright].pythonPath not found: ${p}`);
        }
    }
    const pyExt = vscode.extensions.getExtension<any>('ms-python.python');
    try {
        const api = await pyExt?.activate();
        if (api?.environments?.getActiveEnvironmentPath) {
            const envPath = await api.environments.getActiveEnvironmentPath(folder.uri);
            const env = await api.environments.resolveEnvironment(envPath);
            const exe: string | undefined =
                env?.executable?.uri?.fsPath ?? env?.executable?.path ?? env?.executable?.command;
            if (exe) return exe;
        } else if (api?.getActiveInterpreterPath) {
            const exe = await api.getActiveInterpreterPath(folder.uri);
            if (exe) return exe;
        }
    } catch {
        // ignore
    }
    const exe =
        process.platform === 'win32'
            ? path.join(folder.uri.fsPath, '.venv', 'Scripts', 'python.exe')
            : path.join(folder.uri.fsPath, '.venv', 'bin', 'python');
    try {
        fs.accessSync(exe);
        return exe;
    } catch {
        throw new Error(
            `No Python interpreter found. Set [tool.cyright].pythonPath in pyproject.toml or select an interpreter via the Python extension. Expected .venv at: ${exe}`
        );
    }
}

/**
 * Compile the active .pyx file with cythonize and immediately execute it using the
 * Python interpreter resolved for the active file’s workspace.
 */
export async function runCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'cython') {
        vscode.window.showInformationMessage('Run File: no active Cython file.');
        return;
    }

    // Save if dirty so cythonize sees latest content
    if (editor.document.isDirty) {
        await editor.document.save();
    }

    const file = editor.document.uri;
    const folder = getFolderFor(file);
    if (!folder) {
        vscode.window.showErrorMessage('Active file is not inside a workspace folder');
        return;
    }

    const cfg = await loadCyrightConfig(folder);
    const python = await resolvePython(folder, cfg);

    const cwd = path.dirname(file.fsPath);
    const modName = path.basename(file.fsPath, path.extname(file.fsPath));
    const entry = cfg.entryFunc || 'main';

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(modName)) {
        vscode.window.showErrorMessage(`File base name is not a valid Python module: ${modName}`);
        return;
    }

    out.clear();
    log(`Workspace: ${folder.name}`);
    log(`Using Python: ${python}`);
    log(`Compiling: ${file.fsPath}`);

    await execLogged(python, buildCythonizeArgs(file, cfg), { cwd });

    const env: NodeJS.ProcessEnv = { ...process.env };
    const sep = process.platform === 'win32' ? ';' : ':';
    env.PYTHONPATH = [cwd, process.env.PYTHONPATH || ''].filter(Boolean).join(sep);

    const code = `import importlib, sys; sys.path.insert(0, r'${cwd}'); m = importlib.import_module('${modName}'); getattr(m,'${entry}')()`;
    log(`Running: ${modName}.${entry}()`);
    await execLogged(python, ['-c', code], { cwd, env });

    vscode.window.setStatusBarMessage(`Cython ran: ${modName}.${entry}()`, 2500);
}
