import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";

import type { Fix } from "../controller";
import * as mock from "./mock-vscode";

// Make `import 'vscode'` resolve to the in-memory mock, then load the provider.
const moduleInternals = Module as unknown as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};
const originalLoad = moduleInternals._load;
moduleInternals._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === "vscode" ? mock.api : originalLoad.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UvAlignCodeActionProvider } = require("../codeActions") as typeof import("../codeActions");

const PATH = "/ws/pyproject.toml";
const document = { uri: mock.Uri.file(PATH) };

// `"bandit>=1.9.3"` on line 11: the name starts at column 5, the constraint at column 11.
const banditRange = new mock.Range(11, 5, 11, 18);
const fix = {
  range: banditRange,
  constraintRange: new mock.Range(11, 11, 11, 18),
  newConstraint: ">=1.9.4",
  packageName: "bandit",
} as unknown as Fix;

function provide(
  fixes: Fix[],
  diagnostics: mock.Diagnostic[],
  range: mock.Range = banditRange
): mock.CodeAction[] {
  const controller = { fixesFor: (p: string) => (p === PATH ? fixes : []) };
  const provider = new UvAlignCodeActionProvider(controller as never);
  return provider.provideCodeActions(
    document as never,
    range as never,
    {
      diagnostics,
    } as never
  ) as unknown as mock.CodeAction[];
}

function diagnostic(range: mock.Range, source = "uv-align"): mock.Diagnostic {
  const d = new mock.Diagnostic(range, "Bump bandit>=1.9.3 to >=1.9.4.", 1);
  d.source = source;
  return d;
}

test("offers a preferred quick fix that rewrites only the constraint", () => {
  const d = diagnostic(banditRange);
  const [action, ...rest] = provide([fix], [d]);

  assert.equal(rest.length, 0);
  assert.equal(action.title, "Bump bandit to >=1.9.4");
  assert.equal(action.kind, mock.CodeActionKind.QuickFix);
  assert.equal(action.isPreferred, true);
  assert.deepEqual(action.diagnostics, [d]);
  assert.equal(action.edit!.edits.length, 1);
  const [edit] = action.edit!.edits;
  assert.equal(edit.uri.fsPath, PATH);
  assert.equal(edit.newText, ">=1.9.4");
  assert.ok(edit.range.isEqual(fix.constraintRange));
});

test("ignores diagnostics from other sources", () => {
  assert.deepEqual(provide([fix], [diagnostic(banditRange, "taplo")]), []);
});

test("offers nothing when no fix matches the diagnostic's range", () => {
  // e.g. the unplaced "first line" diagnostic, or squiggles from before an edit.
  assert.deepEqual(provide([fix], [diagnostic(new mock.Range(0, 0, 0, 1000))]), []);
  assert.deepEqual(provide([], [diagnostic(banditRange)]), []);
});

test("offers nothing when the cursor is outside the squiggle", () => {
  assert.deepEqual(provide([fix], [diagnostic(banditRange)], new mock.Range(3, 0, 3, 4)), []);
});

test("offers one fix per squiggle under the cursor", () => {
  const other = {
    range: new mock.Range(11, 30, 11, 45),
    constraintRange: new mock.Range(11, 36, 11, 45),
    newConstraint: ">=2.13.5",
    packageName: "pydantic",
  } as unknown as Fix;
  const wide = new mock.Range(11, 0, 11, 50);
  const actions = provide(
    [fix, other],
    [diagnostic(banditRange), diagnostic(other.range as unknown as mock.Range)],
    wide
  );
  assert.deepEqual(
    actions.map(a => a.title),
    ["Bump bandit to >=1.9.4", "Bump pydantic to >=2.13.5"]
  );
});
