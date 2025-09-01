import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Compile the active .pyx file with cythonize and immediately execute it using the
 * Python interpreter configured in `[tool.cyright]` or VS-Code settings.
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

    const cfg = vscode.workspace.getConfiguration('cython', editor.document.uri);

    const pythonPath: string = cfg.get<string>('pythonPath') || 'python';
    let cythonPath: string = cfg.get<string>('cythonPath') || 'cythonize';
    // If cythonPath is just a bare word, try to infer it next to pythonPath
    if (!cythonPath.includes('/') && pythonPath.includes('/')) {
        const cand = path.join(path.dirname(pythonPath), 'cythonize');
        cythonPath = cand;
    }
    const compileArgs: string[] = cfg.get<string[]>('compileArgs') || ['-i', '-3'];
    const entryFunc: string = cfg.get<string>('entryFunc') || 'main';

    const filePath = editor.document.uri.fsPath;
    const cwd = path.dirname(filePath);
    const modName = path.basename(filePath).replace(/\.(pyx|py)$/i, '');

    const term = vscode.window.createTerminal({ name: 'Cython Run' });
    term.show();

    // Build absolute paths so the commands can be re-used from any shell.
    const compileCmd = `${cythonPath} ${compileArgs.join(' ')} "${filePath}"`;
    const runCmd = `PYTHONPATH="${cwd}:$PYTHONPATH" ${pythonPath} -c "import ${modName}; getattr(${modName}, '${entryFunc}')()"`;

    term.sendText(compileCmd, true);
    term.sendText(runCmd, true);
}
