import { ExecFileException, execFile } from 'node:child_process';
import { Change, parseCheckOutput, summariseError } from './parser';

export type CheckOutcome =
  | { kind: 'in-sync' }
  | { kind: 'out-of-sync'; changes: Change[] }
  | { kind: 'missing-binary'; executable: string }
  | { kind: 'error'; message: string; output: string };

/**
 * Runs `uv-align --check --path <folder>` and classifies the result.
 *
 * Exit codes are not reliable on their own (observed: 0 in sync, 1 drift *and*
 * TOML parse errors, 2 missing file / bad path), so the output is parsed first.
 * The process is never given the project folder as its working directory, which
 * stops Windows from resolving the executable inside the workspace.
 */
export function runCheck(
  executable: string,
  folder: string,
  timeoutMs = 20_000,
): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    execFile(
      executable,
      ['--check', '--path', folder],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const failure = error as ExecFileException | null;
        if (failure?.code === 'ENOENT') {
          resolve({ kind: 'missing-binary', executable });
          return;
        }

        const output = `${stdout}${stderr}`;
        const changes = parseCheckOutput(output);
        if (changes.length > 0) {
          resolve({ kind: 'out-of-sync', changes });
          return;
        }
        if (!failure) {
          resolve({ kind: 'in-sync' });
          return;
        }

        const message = failure.killed
          ? `timed out after ${timeoutMs / 1000}s`
          : summariseError(output) || failure.message;
        resolve({ kind: 'error', message, output });
      },
    );
  });
}
