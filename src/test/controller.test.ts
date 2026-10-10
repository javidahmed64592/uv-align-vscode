import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import Module from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import * as mock from "./mock-vscode";

// Make `import 'vscode'` resolve to the in-memory mock, then load the controller.
const moduleInternals = Module as unknown as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};
const originalLoad = moduleInternals._load;
moduleInternals._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === "vscode" ? mock.api : originalLoad.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UvAlignController } = require("../controller") as typeof import("../controller");

const sampleWorkspace = path.join(__dirname, "../../sample-workspace");
const realCli =
  process.env.UV_ALIGN_BIN ?? (spawnSync("uv-align", ["-h"]).status === 0 ? "uv-align" : undefined);
const needsCli = {
  skip: !realCli && "uv-align not installed (set UV_ALIGN_BIN or put it on PATH)",
};

let root: string;
let controller: InstanceType<typeof UvAlignController> | undefined;

const rel = (absolute: string): string => path.relative(root, absolute).split(path.sep).join("/");
const diagnosticFiles = (): string[] => [...mock.state.diagnostics.keys()].map(rel).sort();
const abs = (relative: string): string => path.join(root, relative);

function startController(executable: string | undefined): void {
  mock.reset([root], executable);
  controller = new UvAlignController();
  controller.start();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "uva-ws-"));
  fs.cpSync(sampleWorkspace, root, { recursive: true });
});

afterEach(() => {
  controller?.dispose();
  controller = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

test(
  "checks only folders with both files, and underlines the drifted lines",
  needsCli,
  async () => {
    startController(realCli);
    await mock.waitFor(() => mock.state.diagnostics.size === 2);
    await mock.sleep(400); // give any wrongly-triggered extra run time to show up

    // in-sync/, pyproject-only/ and lock-only/ produce nothing at all.
    assert.deepEqual(diagnosticFiles(), ["drifted/pyproject.toml", "services/api/pyproject.toml"]);
    assert.equal(mock.state.status.visible, false);

    const text = fs.readFileSync(abs("drifted/pyproject.toml"), "utf8").split("\n");
    const items = mock.state.diagnostics.get(abs("drifted/pyproject.toml"))!;
    assert.deepEqual(
      items
        .map(d => text[d.range.start.line].slice(d.range.start.character, d.range.end.character))
        .sort(),
      ["bandit>=1.9.3", "pydantic>=2.10.0", "sphinx>=9.0.0"]
    );
    assert.ok(items.every(d => d.severity === mock.DiagnosticSeverity.Warning));
    assert.equal(
      items.find(d => d.message.startsWith("Bump"))!.message,
      "Bump bandit>=1.9.3 to >=1.9.4."
    );

    // Every squiggle has a matching fix that replaces just the constraint.
    const fixes = controller!.fixesFor(abs("drifted/pyproject.toml"));
    assert.equal(fixes.length, items.length);
    const bandit = fixes.find(f => f.packageName === "bandit")!;
    assert.equal(bandit.newConstraint, ">=1.9.4");
    const { line } = bandit.constraintRange.start;
    assert.equal(
      text[line].slice(
        bandit.constraintRange.start.character,
        bandit.constraintRange.end.character
      ),
      ">=1.9.3"
    );
  }
);

test("underlines nested projects, extras and name normalisation", needsCli, async () => {
  startController(realCli);
  await mock.waitFor(() => mock.state.diagnostics.has(abs("services/api/pyproject.toml")));

  const text = fs.readFileSync(abs("services/api/pyproject.toml"), "utf8").split("\n");
  const items = mock.state.diagnostics.get(abs("services/api/pyproject.toml"))!;
  assert.deepEqual(
    items
      .map(d => text[d.range.start.line].slice(d.range.start.character, d.range.end.character))
      .sort(),
    ["Pydantic[email]>=2.10.0,<3", "my_package==1.0.0", "numpy >= 1.0"]
  );
});

test("squiggles disappear once the dependencies are brought back in sync", needsCli, async () => {
  startController(realCli);
  await mock.waitFor(() => mock.state.diagnostics.has(abs("drifted/pyproject.toml")));

  const file = abs("drifted/pyproject.toml");
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace("1.9.3", "1.9.4")
      .replace("2.10.0", "2.13.5")
      .replace("9.0.0", "9.1.0")
  );
  mock.events.fileChanged.fire(mock.Uri.file(file));

  await mock.waitFor(() => !mock.state.diagnostics.has(file));
  assert.equal(mock.state.diagnostics.has(abs("services/api/pyproject.toml")), true);
});

test("a folder stops being reported when uv.lock is deleted", needsCli, async () => {
  startController(realCli);
  await mock.waitFor(() => mock.state.diagnostics.has(abs("drifted/pyproject.toml")));

  fs.rmSync(abs("drifted/uv.lock"));
  mock.events.fileDeleted.fire(mock.Uri.file(abs("drifted/uv.lock")));

  await mock.waitFor(() => !mock.state.diagnostics.has(abs("drifted/pyproject.toml")));
  assert.equal(mock.state.status.visible, false);
});

test("a folder is picked up as soon as it gains its missing file", needsCli, async () => {
  startController(realCli);
  await mock.waitFor(() => mock.state.diagnostics.size === 2);

  // lock-only/ has just a uv.lock; adding a stale pyproject.toml makes it a uv project.
  const pyproject = abs("lock-only/pyproject.toml");
  fs.writeFileSync(
    pyproject,
    '[project]\nname = "x"\nversion = "0"\ndependencies = ["requests>=2.30.0"]\n'
  );
  mock.events.fileCreated.fire(mock.Uri.file(pyproject));

  await mock.waitFor(() => mock.state.diagnostics.has(pyproject));
  assert.equal(mock.state.diagnostics.get(pyproject)!.length, 1);
});

test("a missing uv-align shows one quiet status item and no squiggles", async () => {
  startController(path.join(root, "no-such-uv-align"));
  await mock.waitFor(() => mock.state.status.visible);

  assert.match(mock.state.status.tooltip, /uv tool install uv-align/);
  assert.equal(mock.state.diagnostics.size, 0);
});

test("folders with only one of the files are never checked, so nothing is flagged", async () => {
  // Keep only the one-sided folders, and make running uv-align impossible:
  // if the extension tried to check them, the status item would appear.
  for (const dir of ["drifted", "in-sync", "services"]) {
    fs.rmSync(abs(dir), { recursive: true });
  }
  startController(path.join(root, "no-such-uv-align"));
  await mock.sleep(600);

  assert.equal(mock.state.status.visible, false);
  assert.equal(mock.state.diagnostics.size, 0);
});
