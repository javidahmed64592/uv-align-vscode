import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";

import { runCheck } from "../runner";

const fixtures = path.join(__dirname, "../../test-fixtures");
const sampleWorkspace = path.join(__dirname, "../../sample-workspace");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "uva-runner-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** Writes an executable that prints a captured fixture and exits with `code`. */
function fakeCli(name: string, fixture: string, code: number): string {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, `#!/bin/sh\ncat '${path.join(fixtures, fixture)}'\nexit ${code}\n`, {
    mode: 0o755,
  });
  return file;
}

const posixOnly = {
  skip: process.platform === "win32" && "uses shell scripts as fake executables",
};

test("exit 1 with a diff is out-of-sync", posixOnly, async () => {
  const outcome = await runCheck(fakeCli("drift", "drifted.ansi.txt", 1), scratch);
  assert.equal(outcome.kind, "out-of-sync");
  assert.equal(outcome.kind === "out-of-sync" && outcome.changes.length, 3);
});

test("exit 0 is in-sync", posixOnly, async () => {
  const outcome = await runCheck(fakeCli("ok", "in-sync.ansi.txt", 0), scratch);
  assert.deepEqual(outcome, { kind: "in-sync" });
});

test("exit 1 without a diff (TOML parse error) is an error, not drift", posixOnly, async () => {
  const outcome = await runCheck(fakeCli("toml", "toml-error.txt", 1), scratch);
  assert.deepEqual(
    outcome.kind === "error" && outcome.message,
    "Failed to parse TOML in: pyproject.toml"
  );
});

test("exit 2 (missing file) is an error", posixOnly, async () => {
  const outcome = await runCheck(fakeCli("nolock", "missing-lock.txt", 2), scratch);
  assert.equal(outcome.kind, "error");
});

test("a missing executable is reported as such", async () => {
  const outcome = await runCheck(path.join(scratch, "does-not-exist"), scratch);
  assert.deepEqual(outcome, {
    kind: "missing-binary",
    executable: path.join(scratch, "does-not-exist"),
  });
});

test("a hung process times out", posixOnly, async () => {
  const file = path.join(scratch, "hang");
  fs.writeFileSync(file, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  const outcome = await runCheck(file, scratch, 200);
  assert.deepEqual(outcome.kind === "error" && outcome.message, "timed out after 0.2s");
});

// Runs only when the real CLI is available (on PATH, or via UV_ALIGN_BIN).
const realCli =
  process.env.UV_ALIGN_BIN ?? (spawnSync("uv-align", ["-h"]).status === 0 ? "uv-align" : undefined);

test(
  "real uv-align: drifted sample folder",
  { skip: !realCli && "uv-align not installed" },
  async () => {
    const outcome = await runCheck(realCli!, path.join(sampleWorkspace, "drifted"));
    assert.equal(
      outcome.kind === "out-of-sync" && outcome.changes.map(c => c.name).join(","),
      "bandit,pydantic,sphinx"
    );
  }
);

test(
  "real uv-align: in-sync sample folder",
  { skip: !realCli && "uv-align not installed" },
  async () => {
    const outcome = await runCheck(realCli!, path.join(sampleWorkspace, "in-sync"));
    assert.deepEqual(outcome, { kind: "in-sync" });
  }
);
