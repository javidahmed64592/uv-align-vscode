import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { locateChange, quotedStrings } from "../locator";
import { Change } from "../parser";

const sample = (relative: string): string =>
  fs.readFileSync(path.join(__dirname, "../../sample-workspace", relative), "utf8");

const change = (name: string, oldConstraint: string, newConstraint = ">=0"): Change => ({
  name,
  oldConstraint,
  newConstraint,
  resolvedVersion: undefined,
});

/** The text a squiggle would cover for each location. */
const underlined = (text: string, changeToFind: Change): string[] => {
  const lines = text.split("\n");
  return locateChange(text, changeToFind).map(l => lines[l.line].slice(l.start, l.end));
};

test("underlines name and constraint of a plain requirement", () => {
  const text = sample("drifted/pyproject.toml");
  assert.deepEqual(underlined(text, change("bandit", ">=1.9.3")), ["bandit>=1.9.3"]);
  assert.deepEqual(underlined(text, change("pydantic", ">=2.10.0")), ["pydantic>=2.10.0"]);
});

test("is not confused by a trailing comment", () => {
  const text = sample("drifted/pyproject.toml");
  assert.deepEqual(underlined(text, change("sphinx", ">=9.0.0")), ["sphinx>=9.0.0"]);
});

test("includes extras and upper bounds, matches names case- and separator-insensitively", () => {
  const text = sample("services/api/pyproject.toml");
  assert.deepEqual(underlined(text, change("Pydantic", ">=2.10.0,<3")), [
    "Pydantic[email]>=2.10.0,<3",
  ]);
  assert.deepEqual(underlined(text, change("pydantic", ">=2.10.0,<3")), [
    "Pydantic[email]>=2.10.0,<3",
  ]);
  assert.deepEqual(underlined(text, change("my-package", "==1.0.0")), ["my_package==1.0.0"]);
});

test("stops before the environment marker and tolerates spaces", () => {
  const text = sample("services/api/pyproject.toml");
  assert.deepEqual(underlined(text, change("numpy", ">= 1.0")), ["numpy >= 1.0"]);
  assert.deepEqual(underlined(text, change("numpy", ">=1.0")), ["numpy >= 1.0"]);
});

test("never matches URL requirements or unrelated strings", () => {
  const text = sample("services/api/pyproject.toml");
  assert.deepEqual(locateChange(text, change("gitpkg", "")), []);
  assert.deepEqual(locateChange(text, change("api", "")), []);
  assert.deepEqual(locateChange(text, change("api", ">=3.12")), []);
});

test("only matches the stale constraint, not an already-fixed duplicate", () => {
  const text = ['dependencies = ["requests>=2.32.5"]', 'dev = ["requests>=2.30.0"]'].join("\n");
  const found = locateChange(text, change("requests", ">=2.30.0"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
});

test("returns every occurrence of an identical stale requirement", () => {
  const text = ['dependencies = ["requests>=2.30.0"]', 'dev = ["a>=1", "requests>=2.30.0"]'].join(
    "\n"
  );
  assert.deepEqual(
    locateChange(text, change("requests", ">=2.30.0")).map(l => l.line),
    [0, 1]
  );
});

test("skips comments and multi-line strings, and keeps line numbers right after them", () => {
  const text = [
    '# "requests>=2.30.0" in a comment',
    'description = """',
    '  "requests>=2.30.0" inside prose',
    '"""',
    "readme = 'single quoted'",
    "dependencies = [",
    "    'requests>=2.30.0',",
    "]",
  ].join("\n");
  const found = locateChange(text, change("requests", ">=2.30.0"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 6);
  assert.equal(text.split("\n")[6].slice(found[0].start, found[0].end), "requests>=2.30.0");
});

test("handles CRLF line endings", () => {
  const text = 'dependencies = [\r\n    "requests>=2.30.0",\r\n]\r\n';
  const found = locateChange(text, change("requests", ">=2.30.0"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].start, 5);
});

test("quotedStrings survives an unterminated string", () => {
  const values = [...quotedStrings('a = "oops\nb = "fine"\n')].map(s => s.value);
  assert.deepEqual(values, ["fine"]);
});
