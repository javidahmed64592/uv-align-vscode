// Downloads the uv-align release for one platform into bin/, so it can be bundled in a
// platform-specific VSIX. Usage: node scripts/fetch-binary.mjs <vscode-target> [version]
// e.g. node scripts/fetch-binary.mjs linux-x64 0.2.0
// The version defaults to "uvAlignVersion" in package.json.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// VS Code target -> cargo-dist target triple (see uv-align's dist-workspace.toml).
const TARGETS = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const manifest = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")
);
const [target, requested] = process.argv.slice(2);
const version = requested ?? manifest.uvAlignVersion;
const triple = TARGETS[target];
if (!triple || !version) {
  console.error(`Usage: fetch-binary.mjs <${Object.keys(TARGETS).join("|")}> [version]`);
  process.exit(1);
}

const windows = target.startsWith("win32");
const archive = `uv-align-${triple}.${windows ? "zip" : "tar.xz"}`;
const url = `https://github.com/javidahmed64592/uv-align/releases/download/v${version}/${archive}`;
const binary = windows ? "uv-align.exe" : "uv-align";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "uva-fetch-"));
try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  const file = path.join(scratch, archive);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  if (windows) {
    execFileSync("unzip", ["-q", file, "-d", scratch]);
  } else {
    execFileSync("tar", ["-xf", file, "-C", scratch]);
  }

  const found = fs
    .readdirSync(scratch, { recursive: true })
    .find(entry => path.basename(String(entry)) === binary);
  if (!found) {
    throw new Error(`${binary} not found in ${archive}`);
  }
  const out = path.join(import.meta.dirname, "..", "bin");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  fs.copyFileSync(path.join(scratch, String(found)), path.join(out, binary));
  fs.chmodSync(path.join(out, binary), 0o755);
  console.log(`Bundled ${binary} v${version} (${triple}) into bin/`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
