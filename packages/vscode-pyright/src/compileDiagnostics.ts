import * as cp from 'child_process';
import * as path from 'path';
import {
    Diagnostic,
    DiagnosticCollection,
    DiagnosticSeverity,
    ExtensionContext,
    languages,
    Position,
    Range,
    TextDocument,
    workspace,
} from 'vscode';

/**
 * Registers live "cython --fast-fail" compile diagnostics. Whenever the user saves (or opens)
 * a `.pyx`/`.pxd`/`.pxi` file, we invoke the Cython compiler in syntax-check mode and convert
 * its stderr messages to VS Code diagnostics – similar to clang-tidy/clangd.
 */
export function registerCompileDiagnostics(context: ExtensionContext) {
    const collection: DiagnosticCollection = languages.createDiagnosticCollection('cython-compile');
    context.subscriptions.push(collection);

    // Track one running compiler process per file so we can cancel stale runs.
    const activeProcesses = new Map<string, cp.ChildProcess>();

    function runCompiler(doc: TextDocument) {
        if (doc.languageId !== 'cython') {
            return;
        }
        const config = workspace.getConfiguration('cython', doc.uri);
        if (!config.get<boolean>('showCompileDiagnostics', false)) {
            return;
        }

        const filePath = doc.uri.fsPath;

        // Kill any previous compile still running for this file.
        const prev = activeProcesses.get(filePath);
        if (prev) {
            prev.kill();
        }

        // Use Cython in fast-fail (syntax-only) mode; this avoids generating .c files.
        const args = ['--fast-fail', '-3', filePath];
        const proc = cp.spawn('cython', args, { shell: false });
        activeProcesses.set(filePath, proc);

        let stderr = '';
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        proc.on('close', () => {
            activeProcesses.delete(filePath);
            const diagnostics: Diagnostic[] = [];
            const regex = /^(.*?):(\d+):(\d+): (?:error: )?(.*)$/gm;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(stderr))) {
                const [, matchPath, lineStr, colStr, message] = match;
                if (path.resolve(matchPath) !== path.resolve(filePath)) {
                    // Ignore diagnostics that belong to a different file.
                    continue;
                }
                const line = parseInt(lineStr, 10) - 1;
                const col = parseInt(colStr, 10) - 1;
                const range = new Range(new Position(line, col), new Position(line, col + 1));
                diagnostics.push(new Diagnostic(range, message.trim(), DiagnosticSeverity.Error));
            }
            collection.set(doc.uri, diagnostics);
        });
    }

    // Simple debounce per document to avoid flooding compiler on rapid saves.
    const debounceTimers = new Map<string, NodeJS.Timeout>();
    function scheduleCompile(doc: TextDocument) {
        const uriKey = doc.uri.toString();
        clearTimeout(debounceTimers.get(uriKey));
        debounceTimers.set(
            uriKey,
            setTimeout(() => {
                runCompiler(doc);
            }, 300)
        );
    }

    context.subscriptions.push(workspace.onDidOpenTextDocument(scheduleCompile));
    context.subscriptions.push(workspace.onDidSaveTextDocument(scheduleCompile));
    context.subscriptions.push(
        workspace.onDidCloseTextDocument((doc) => {
            collection.delete(doc.uri);
            const proc = activeProcesses.get(doc.uri.fsPath);
            if (proc) {
                proc.kill();
                activeProcesses.delete(doc.uri.fsPath);
            }
        })
    );
}
