import * as fs from "node:fs";
import * as path from "node:path";

const BINARY_NAME = "uv-align";

/** Where the platform-specific VSIX keeps its copy of the CLI, relative to the extension root. */
export function bundledBinaryPath(extensionPath: string, platform = process.platform): string {
  return path.join(extensionPath, "bin", platform === "win32" ? `${BINARY_NAME}.exe` : BINARY_NAME);
}

/**
 * Picks the executable to run: the `uvAlign.executablePath` setting if set, then the
 * binary bundled with the extension, then `uv-align` on the `PATH`.
 */
export function resolveExecutable(
  configured: string | undefined,
  extensionPath: string | undefined
): string {
  if (configured) {
    return configured;
  }
  if (extensionPath) {
    const bundled = bundledBinaryPath(extensionPath);
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }
  return BINARY_NAME;
}
