export class CythonDebugConfigurationProvider {
    pythonPath: string | undefined;

    setPythonPath(path: string) {
        this.pythonPath = path;
    }
}


