import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";

import { bundledBinaryPath, resolveExecutable } from "../binary";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "uva-binary-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function withBundled(): string {
  const bundled = bundledBinaryPath(root);
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, "");
  return bundled;
}

test("falls back to PATH when nothing is bundled", () => {
  assert.equal(resolveExecutable(undefined, root), "uv-align");
  assert.equal(resolveExecutable("", undefined), "uv-align");
});

test("uses the bundled binary when present", () => {
  const bundled = withBundled();
  assert.equal(resolveExecutable(undefined, root), bundled);
});

test("the configured path wins over the bundled binary", () => {
  withBundled();
  assert.equal(resolveExecutable("/custom/uv-align", root), "/custom/uv-align");
});

test("windows bundles uv-align.exe", () => {
  assert.equal(bundledBinaryPath("/ext", "win32"), path.join("/ext", "bin", "uv-align.exe"));
});
