import { Change, normaliseName } from './parser';

/** Zero-based position of a requirement inside pyproject.toml. */
export interface Location {
  line: number;
  start: number;
  end: number;
}

interface QuotedString {
  line: number;
  /** Column of the first character inside the quotes. */
  column: number;
  value: string;
}

/**
 * Yields every single-line quoted string in a TOML document, skipping comments
 * and multi-line strings. A full TOML parser is unnecessary here: we only need
 * the position of strings that look like requirements.
 */
export function* quotedStrings(text: string): Generator<QuotedString> {
  const n = text.length;
  let i = 0;
  let line = 0;
  let lineStart = 0;

  const advanceTo = (end: number): void => {
    for (let k = i; k < end; k++) {
      if (text[k] === '\n') {
        line++;
        lineStart = k + 1;
      }
    }
    i = end;
  };

  while (i < n) {
    const ch = text[i];

    if (ch === '#') {
      const eol = text.indexOf('\n', i);
      advanceTo(eol === -1 ? n : eol);
      continue;
    }

    if (ch === '"' || ch === "'") {
      const triple = ch.repeat(3);
      if (text.startsWith(triple, i)) {
        let j = i + 3;
        while (j < n && !text.startsWith(triple, j)) {
          j += ch === '"' && text[j] === '\\' ? 2 : 1;
        }
        advanceTo(Math.min(j + 3, n));
        continue;
      }

      let j = i + 1;
      while (j < n && text[j] !== '\n' && text[j] !== ch) {
        j += ch === '"' && text[j] === '\\' ? 2 : 1;
      }
      if (j < n && text[j] === ch) {
        yield { line, column: i + 1 - lineStart, value: text.slice(i + 1, j) };
        advanceTo(j + 1);
      } else {
        advanceTo(Math.min(j, n));
      }
      continue;
    }

    advanceTo(i + 1);
  }
}

// name, optional [extras], version constraint, optional "; marker". URL requirements
// ("pkg @ git+...") deliberately do not match: they have no version to compare.
const REQUIREMENT =
  /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[[^\]]*\])?\s*([^;@]*?)\s*(?:;.*)?$/d;

const stripWhitespace = (s: string): string => s.replace(/\s+/g, '');

/**
 * Finds every requirement string in `text` that matches the change: same package
 * (PEP 503 normalised) and the same constraint text uv-align reported. Identical
 * requirements in several groups are all returned, so each one gets underlined.
 */
export function locateChange(text: string, change: Change): Location[] {
  const wantedName = normaliseName(change.name);
  const wantedConstraint = stripWhitespace(change.oldConstraint);
  const found: Location[] = [];

  for (const str of quotedStrings(text)) {
    const match = REQUIREMENT.exec(str.value);
    if (!match?.indices) {
      continue;
    }
    const [nameStart] = match.indices[1];
    const [constraintStart, constraintEnd] = match.indices[2];
    if (constraintEnd === constraintStart) {
      continue;
    }
    if (normaliseName(match[1]) !== wantedName) {
      continue;
    }
    if (stripWhitespace(match[2]) !== wantedConstraint) {
      continue;
    }
    found.push({
      line: str.line,
      start: str.column + nameStart,
      end: str.column + constraintEnd,
    });
  }
  return found;
}
