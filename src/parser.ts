/** One out-of-sync dependency, as reported by `uv-align --check`. */
export interface Change {
  /** Package name exactly as written in pyproject.toml (e.g. "Pydantic"). */
  name: string;
  /** Constraint currently in pyproject.toml, e.g. ">=2.10.0,<3". */
  oldConstraint: string;
  /** Constraint uv-align would write instead, e.g. ">=2.13.5,<3". */
  newConstraint: string;
  /** Version resolved in uv.lock, read from the new constraint's first clause. */
  resolvedVersion: string | undefined;
}

// uv-align colours its output even when stdout is not a terminal and ignores
// NO_COLOR, so escape codes must be stripped before parsing.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** PEP 503 normalisation: "My_Package" and "my-package" compare equal. */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** "- name   >=1.0" or "+ name   >=2.0" (name never contains spaces; the constraint may). */
const DIFF_LINE = /^([-+])\s+(\S+)\s+(\S.*?)\s*$/;

const FIRST_CLAUSE = /^\s*(?:===|==|~=|!=|>=|<=|>|<)\s*([^\s,;]+)/;

export function firstVersion(constraint: string): string | undefined {
  return FIRST_CLAUSE.exec(constraint)?.[1];
}

/**
 * Extracts the changes from `uv-align --check` output. A change is a "-" line
 * immediately followed by a "+" line for the same package; anything else
 * (headers, summary, error text) is ignored.
 */
export function parseCheckOutput(output: string): Change[] {
  const changes: Change[] = [];
  let removed: { name: string; constraint: string } | undefined;

  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const match = DIFF_LINE.exec(line);
    if (!match) {
      removed = undefined;
      continue;
    }
    const [, sign, name, constraint] = match;
    if (sign === "-") {
      removed = { name, constraint };
      continue;
    }
    if (removed && normaliseName(removed.name) === normaliseName(name)) {
      changes.push({
        name: removed.name,
        oldConstraint: removed.constraint,
        newConstraint: constraint,
        resolvedVersion: firstVersion(constraint),
      });
    }
    removed = undefined;
  }
  return changes;
}

/** First meaningful line of an error, without uv-align's "Error:" / "✖" prefixes. */
export function summariseError(output: string): string {
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:Error:\s*)?(?:[✖✗]\s*)?/, "").trim();
    if (line) {
      return line;
    }
  }
  return "";
}
