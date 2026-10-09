import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { firstVersion, parseCheckOutput, stripAnsi, summariseError } from '../parser';

// Fixtures are real captures of uv-align 0.2.0 output (see test-fixtures/).
const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '../../test-fixtures', name), 'utf8');

test('parses the output pasted from a real project', () => {
  assert.deepEqual(parseCheckOutput(fixture('user-pasted.txt')), [
    { name: 'bandit', oldConstraint: '>=1.9.3', newConstraint: '>=1.9.4', resolvedVersion: '1.9.4' },
    { name: 'pydantic', oldConstraint: '>=2.10.0', newConstraint: '>=2.13.5', resolvedVersion: '2.13.5' },
    { name: 'sphinx', oldConstraint: '>=9.0.0', newConstraint: '>=9.1.0', resolvedVersion: '9.1.0' },
  ]);
});

test('parses the same output when it contains ANSI colour codes', () => {
  const coloured = fixture('drifted.ansi.txt');
  assert.match(coloured, /\x1b\[/, 'fixture should really contain escape codes');
  assert.deepEqual(parseCheckOutput(coloured), parseCheckOutput(fixture('user-pasted.txt')));
});

test('keeps original name casing, version suffixes and spacing', () => {
  assert.deepEqual(parseCheckOutput(fixture('api.ansi.txt')), [
    { name: 'Pydantic', oldConstraint: '>=2.10.0,<3', newConstraint: '>=2.13.5,<3', resolvedVersion: '2.13.5' },
    { name: 'my_package', oldConstraint: '==1.0.0', newConstraint: '==1.2.0', resolvedVersion: '1.2.0' },
    { name: 'numpy', oldConstraint: '>= 1.0', newConstraint: '>= 2.1.0', resolvedVersion: '2.1.0' },
  ]);
});

test('reports nothing when dependencies are in sync or the run failed', () => {
  assert.deepEqual(parseCheckOutput(fixture('in-sync.ansi.txt')), []);
  assert.deepEqual(parseCheckOutput(fixture('toml-error.txt')), []);
  assert.deepEqual(parseCheckOutput(fixture('missing-lock.txt')), []);
});

test('keeps one change per occurrence when a package appears in several groups', () => {
  const output = [
    '- requests         >=2.30.0',
    '+ requests         >=2.32.5',
    '',
    '- requests         >=2.30.0',
    '+ requests         >=2.32.5',
  ].join('\n');
  assert.equal(parseCheckOutput(output).length, 2);
});

test('ignores a "-" line that is not followed by its "+" line', () => {
  const output = ['- foo >=1.0', '', '+ foo >=2.0', '- bar >=1.0', '+ baz >=2.0'].join('\n');
  assert.deepEqual(parseCheckOutput(output), []);
});

test('stripAnsi and firstVersion', () => {
  assert.equal(stripAnsi('\x1b[91m-\x1b[39m x'), '- x');
  assert.equal(firstVersion('>=2.13.5,<3'), '2.13.5');
  assert.equal(firstVersion('~= 2.0.5'), '2.0.5');
  assert.equal(firstVersion(''), undefined);
});

test('summariseError drops the "Error:" and "✖" decoration', () => {
  assert.equal(summariseError(fixture('toml-error.txt')), 'Failed to parse TOML in: pyproject.toml');
  assert.match(summariseError(fixture('missing-lock.txt')), /^The required file 'uv\.lock' does not exist/);
  assert.equal(summariseError(''), '');
});
