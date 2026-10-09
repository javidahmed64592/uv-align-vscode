/**
 * A tiny in-memory stand-in for the parts of the `vscode` API the controller uses,
 * so its behaviour (which folders get checked, when squiggles appear and disappear)
 * can be tested without launching VS Code. File access is backed by the real disk.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };
  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string,
  ) {}
  static file(p: string): Uri {
    return new Uri('file', path.resolve(p));
  }
}

export class Range {
  readonly start: { line: number; character: number };
  readonly end: { line: number; character: number };
  constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
    this.start = { line: startLine, character: startChar };
    this.end = { line: endLine, character: endChar };
  }
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

export class Diagnostic {
  source?: string;
  code?: string | number;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: number = DiagnosticSeverity.Error,
  ) {}
}

const EXCLUDED = new Set(['node_modules', '.venv', 'venv', '.git', 'target', '__pycache__', 'site-packages']);

async function findUvLocks(dir: string, out: string[]): Promise<void> {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED.has(entry.name)) {
        await findUvLocks(path.join(dir, entry.name), out);
      }
    } else if (entry.name === 'uv.lock') {
      out.push(path.join(dir, entry.name));
    }
  }
}

/** Everything a test may want to look at or poke. Replaced wholesale by `reset`. */
export const state = {
  roots: [] as string[],
  executablePath: undefined as string | undefined,
  diagnostics: new Map<string, Diagnostic[]>(),
  status: { visible: false, text: '', tooltip: '' },
};

export const events = {
  fileCreated: new Emitter<Uri>(),
  fileChanged: new Emitter<Uri>(),
  fileDeleted: new Emitter<Uri>(),
  foldersChanged: new Emitter<void>(),
  configChanged: new Emitter<{ affectsConfiguration(section: string): boolean }>(),
};

export function reset(roots: string[], executablePath: string | undefined): void {
  state.roots = roots;
  state.executablePath = executablePath;
  state.diagnostics = new Map();
  state.status = { visible: false, text: '', tooltip: '' };
}

export async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const api = {
  Uri,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  StatusBarAlignment: { Left: 1, Right: 2 },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri: Uri, items: Diagnostic[]) => void state.diagnostics.set(uri.fsPath, items),
      delete: (uri: Uri) => void state.diagnostics.delete(uri.fsPath),
      dispose: () => undefined,
    }),
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }),
    createStatusBarItem: () => ({
      set text(value: string) {
        state.status.text = value;
      },
      set tooltip(value: string) {
        state.status.tooltip = value;
      },
      command: undefined as string | undefined,
      show: () => void (state.status.visible = true),
      hide: () => void (state.status.visible = false),
      dispose: () => undefined,
    }),
  },
  workspace: {
    findFiles: async (_include: string, _exclude: string, maxResults: number) => {
      const found: string[] = [];
      for (const root of state.roots) {
        await findUvLocks(root, found);
      }
      return found.slice(0, maxResults).map((p) => Uri.file(p));
    },
    fs: {
      stat: async (uri: Uri) => fsp.stat(uri.fsPath),
      readFile: async (uri: Uri) => fsp.readFile(uri.fsPath),
    },
    createFileSystemWatcher: () => ({
      onDidCreate: events.fileCreated.event,
      onDidChange: events.fileChanged.event,
      onDidDelete: events.fileDeleted.event,
      dispose: () => undefined,
    }),
    onDidChangeWorkspaceFolders: events.foldersChanged.event,
    onDidChangeConfiguration: events.configChanged.event,
    getConfiguration: () => ({ get: (key: string) => (key === 'executablePath' ? state.executablePath : undefined) }),
  },
};
