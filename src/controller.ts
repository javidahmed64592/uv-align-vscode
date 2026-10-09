import * as path from 'node:path';
import * as vscode from 'vscode';
import { locateChange } from './locator';
import { Change, normaliseName } from './parser';
import { CheckOutcome, runCheck } from './runner';

const EXCLUDED_DIRS = ['node_modules', '.venv', 'venv', '.git', 'target', '__pycache__', 'site-packages'];
const EXCLUDE_GLOB = `**/{${EXCLUDED_DIRS.join(',')}}/**`;
const DEBOUNCE_MS = 500;
const MAX_PROJECTS = 500;

export function isExcluded(fsPath: string): boolean {
  return fsPath.split(/[\\/]/).some((segment) => EXCLUDED_DIRS.includes(segment));
}

/**
 * Keeps diagnostics in sync with `uv-align --check` for every folder that holds
 * both a pyproject.toml and a uv.lock. Folders with only one of the two are never
 * checked and never reported.
 */
export class UvAlignController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('uv-align');
  private readonly output = vscode.window.createOutputChannel('uv-align');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);

  /** Valid uv project folders -> their pyproject.toml. */
  private readonly projects = new Map<string, vscode.Uri>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Identifies the newest run per folder, so slow older runs can be discarded. */
  private readonly latestRun = new Map<string, object>();
  private readonly problems = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  start(): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/{pyproject.toml,uv.lock}');
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => this.onFileEvent(uri)),
      watcher.onDidChange((uri) => this.onFileEvent(uri)),
      watcher.onDidDelete((uri) => this.onFileEvent(uri)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.scan()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('uvAlign.executablePath')) {
          this.recheck();
        }
      }),
    );
    void this.scan();
  }

  recheck(): void {
    for (const folder of this.projects.keys()) {
      this.schedule(folder, 0);
    }
    void this.scan();
  }

  showOutput(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.disposables.forEach((d) => d.dispose());
    this.diagnostics.dispose();
    this.output.dispose();
    this.status.dispose();
  }

  /** Finds every folder with both files; forgets folders that no longer qualify. */
  private async scan(): Promise<void> {
    const locks = await vscode.workspace.findFiles('**/uv.lock', EXCLUDE_GLOB, MAX_PROJECTS);
    const found = new Set<string>();
    for (const lock of locks) {
      if (lock.scheme !== 'file') {
        continue;
      }
      const folder = path.dirname(lock.fsPath);
      if (await this.isUvProject(folder)) {
        found.add(folder);
      }
    }
    if (this.disposed) {
      return;
    }
    for (const folder of [...this.projects.keys()]) {
      if (!found.has(folder)) {
        this.forget(folder);
      }
    }
    for (const folder of found) {
      if (!this.projects.has(folder)) {
        this.schedule(folder, 0);
      }
    }
  }

  private onFileEvent(uri: vscode.Uri): void {
    if (uri.scheme !== 'file' || isExcluded(uri.fsPath)) {
      return;
    }
    this.schedule(path.dirname(uri.fsPath), DEBOUNCE_MS);
  }

  private schedule(folder: string, delayMs: number): void {
    clearTimeout(this.timers.get(folder));
    this.timers.set(
      folder,
      setTimeout(() => {
        this.timers.delete(folder);
        void this.refresh(folder);
      }, delayMs),
    );
  }

  private async refresh(folder: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (!(await this.isUvProject(folder))) {
      this.forget(folder);
      return;
    }

    const pyproject = vscode.Uri.file(path.join(folder, 'pyproject.toml'));
    this.projects.set(folder, pyproject);
    const run = {};
    this.latestRun.set(folder, run);

    const configured = vscode.workspace.getConfiguration('uvAlign').get<string>('executablePath');
    const outcome = await runCheck(configured || 'uv-align', folder);
    if (this.disposed || this.latestRun.get(folder) !== run) {
      return;
    }
    await this.apply(folder, pyproject, run, outcome);
  }

  private async apply(
    folder: string,
    pyproject: vscode.Uri,
    run: object,
    outcome: CheckOutcome,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'in-sync':
        this.diagnostics.delete(pyproject);
        this.setProblem(folder, undefined);
        this.log(`${folder}: in sync`);
        return;

      case 'out-of-sync': {
        let text: string;
        try {
          text = Buffer.from(await vscode.workspace.fs.readFile(pyproject)).toString('utf8');
        } catch {
          return; // File vanished mid-run; the watcher will trigger another refresh.
        }
        if (this.disposed || this.latestRun.get(folder) !== run) {
          return;
        }
        this.diagnostics.set(pyproject, this.buildDiagnostics(text, outcome.changes));
        this.setProblem(folder, undefined);
        this.log(`${folder}: ${outcome.changes.length} out of sync`);
        return;
      }

      case 'missing-binary':
        this.diagnostics.delete(pyproject);
        this.setProblem(
          folder,
          `Could not run '${outcome.executable}'. Install it with "uv tool install uv-align" or set uvAlign.executablePath.`,
        );
        this.log(`${folder}: executable '${outcome.executable}' not found`);
        return;

      case 'error':
        this.diagnostics.delete(pyproject);
        this.setProblem(folder, `${path.basename(folder)}: ${outcome.message}`);
        this.log(`${folder}: ${outcome.message}\n${outcome.output}`);
        return;
    }
  }

  private buildDiagnostics(text: string, changes: Change[]): vscode.Diagnostic[] {
    const items: vscode.Diagnostic[] = [];
    const unplaced: Change[] = [];
    const seen = new Set<string>();

    for (const change of changes) {
      // uv-align prints a line per occurrence, but locateChange already returns every match.
      const key = `${normaliseName(change.name)}|${change.oldConstraint}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const locations = locateChange(text, change);
      if (locations.length === 0) {
        unplaced.push(change);
        continue;
      }
      for (const loc of locations) {
        items.push(this.diagnosticFor(change, new vscode.Range(loc.line, loc.start, loc.line, loc.end)));
      }
    }

    // Never drop drift silently: if a line can't be found, report it on the first line.
    for (const change of unplaced) {
      items.push(
        this.diagnosticFor(change, new vscode.Range(0, 0, 0, 1000), ' (could not find this line in the file)'),
      );
    }
    return items;
  }

  private diagnosticFor(change: Change, range: vscode.Range, suffix = ''): vscode.Diagnostic {
    const resolved = change.resolvedVersion ?? 'a different version';
    const message =
      `${change.name}: pyproject.toml declares ${change.oldConstraint}, but uv.lock resolves ${resolved}. ` +
      `uv-align would set ${change.newConstraint}.${suffix}`;
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = 'uv-align';
    diagnostic.code = 'out-of-sync';
    return diagnostic;
  }

  private forget(folder: string): void {
    clearTimeout(this.timers.get(folder));
    this.timers.delete(folder);
    this.latestRun.delete(folder);
    const pyproject = this.projects.get(folder);
    if (pyproject) {
      this.diagnostics.delete(pyproject);
      this.projects.delete(folder);
    }
    this.setProblem(folder, undefined);
  }

  /** The status bar item only exists while something is wrong; the happy path stays silent. */
  private setProblem(folder: string, message: string | undefined): void {
    if (message === undefined) {
      this.problems.delete(folder);
    } else {
      this.problems.set(folder, message);
    }

    const messages = [...new Set(this.problems.values())];
    if (messages.length === 0) {
      this.status.hide();
      return;
    }
    this.status.text = '$(warning) uv-align';
    this.status.tooltip = messages.join('\n');
    this.status.command = 'uvAlign.showOutput';
    this.status.show();
  }

  private async isUvProject(folder: string): Promise<boolean> {
    return (
      (await this.exists(path.join(folder, 'pyproject.toml'))) &&
      (await this.exists(path.join(folder, 'uv.lock')))
    );
  }

  private async exists(fsPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
      return true;
    } catch {
      return false;
    }
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
