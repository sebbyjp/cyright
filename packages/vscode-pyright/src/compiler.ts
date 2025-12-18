// Compiler command
import { exec } from 'child_process';
import { ExtensionContext, OutputChannel, ProgressLocation, window, workspace, Uri } from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// (no pathUtils usage here)

class ProgressReporter {
    outputChannel: OutputChannel;
    private _filename: string;

    constructor(filename: string, outputChannel: OutputChannel) {
        this.outputChannel = outputChannel;
        this._filename = filename;
    }

    starting() {
        return `Compiling file: ${this._filename}`;
    }
    running(command: string) {
        return `Running command: ${command}`;
    }
    compiling() {
        return 'Compiling...';
    }
    done() {
        return `File ${this._filename} compiled successfully`;
    }
    invalidExtension() {
        return 'Expected file with extension ".pyx"';
    }
    compileError() {
        return `Error compiling file: ${this._filename}`;
    }
    optionOutput() {
        return 'Show Output';
    }
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

function parseCyrightCompileArgs(raw: string): string[] | undefined {
    const lines = String(raw).split(/\r?\n/);
    let inCyright = false;
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
        const m = line.match(/^compileArgs\s*=\s*(.+)$/);
        if (!m) continue;
        const val = m[1].trim();
        if (val.startsWith('[') && val.endsWith(']')) {
            const inner = val.slice(1, -1).trim();
            if (!inner) return [];
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
            return parts.map((p) => {
                const s = p.trim();
                if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
                return s;
            });
        }
    }
    return undefined;
}

function getCompileArgsForFile(filename: string): string[] {
    try {
        const folder = workspace.getWorkspaceFolder(Uri.file(filename));
        if (folder) {
            const pyproject = path.join(folder.uri.fsPath, 'pyproject.toml');
            const raw = fs.readFileSync(pyproject, 'utf8');
            const parsed = parseCyrightCompileArgs(raw);
            if (parsed) {
                const arr = parsed.slice();
                if (!arr.includes('-i')) arr.push('-i');
                return arr;
            }
        }
    } catch {
        // ignore
    }
    return ['-i', '-3'];
}

function _compile(filename: string, pythonPath: string, reporter: ProgressReporter, callback: () => void) {
    const args = getCompileArgsForFile(filename);
    const cmd = [
        JSON.stringify(pythonPath),
        '-m',
        'Cython.Build.Cythonize',
        ...args,
        JSON.stringify(filename),
    ];
    const command = cmd.join(' ');

    reporter.outputChannel.appendLine(reporter.starting());
    reporter.outputChannel.appendLine(reporter.running(command));
    reporter.outputChannel.appendLine('');

    const messageCallback = (item: string | undefined) => {
        switch (item) {
            case reporter.optionOutput():
                reporter.outputChannel.show();
                break;
            default:
                break;
        }
    };

    exec(command, (error, stdout, stderr) => {
        callback();
        reporter.outputChannel.appendLine(stdout);
        reporter.outputChannel.appendLine(stderr);
        let promise: Thenable<string | undefined>;
        if (error?.code !== undefined) {
            reporter.outputChannel.appendLine(reporter.compileError());
            promise = window.showErrorMessage(reporter.compileError(), reporter.optionOutput());
        } else {
            reporter.outputChannel.appendLine(reporter.done());
            promise = window.showInformationMessage(reporter.done(), reporter.optionOutput());
        }
        reporter.outputChannel.appendLine('');
        promise.then(messageCallback);
    });
}

function _compileWithProgress(filename: string, pythonPath: string, reporter: ProgressReporter, callback: () => void) {
    const options = {
        location: ProgressLocation.Notification,
        title: 'Cythonize',
    };

    window.withProgress(options, async (progress) => {
        progress.report({
            message: reporter.compiling(),
        });
        _compile(filename, pythonPath, reporter, callback);
    });
}

function _compileCurrentFileCommand(
    filename: string,
    pythonPath: string,
    outputChannel: OutputChannel,
    callback: () => void
) {
    const reporter = new ProgressReporter(filename, outputChannel);

    if (!filename.endsWith('.pyx')) {
        reporter.outputChannel.appendLine(reporter.invalidExtension());
        callback();
        return;
    }
    _compileWithProgress(filename, pythonPath, reporter, callback);
}

export class CythonCompiler {
    private _context: ExtensionContext;
    private _outputChannel: OutputChannel;
    private _pythonPath?: string;
    private _compiling: boolean;

    constructor(context: ExtensionContext) {
        this._context = context;
        this._outputChannel = window.createOutputChannel('Cython - compile');
        this._compiling = false;
    }

    private _compilingDone() {
        this._compiling = false;
    }

    setPythonPath(pythonPath?: string) {
        this._pythonPath = pythonPath;
    }

    compileCurrentFile(path: string) {
        if (!this._pythonPath || this._compiling) {
            return;
        }
        this._compiling = true;
        _compileCurrentFileCommand(path, this._pythonPath, this._outputChannel, this._compilingDone.bind(this));
    }
}
