import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLength, formatLength } from '../../src/core/length';

void test('parse decimal feet, marked inches and mixed lengths', () => {
  for (const [text, feet] of [
    ['10', 10], ['10.5', 10.5], ['16"', 16 / 12], ['16in', 16 / 12],
    ['3 5/8"', 3.625 / 12], ['3-5/8"', 3.625 / 12], ['0.625"', 0.625 / 12],
    ["10' 6\"", 10.5], ["10'6", 10.5], ['10ft 6in', 10.5], ["10' 6 1/2\"", 10 + 6.5 / 12],
    ['-2ft 6in', -2.5],
  ] as const) assert.equal(parseLength(text), feet);
  for (const text of ['', '6 1/2', '1/0"', '10 something', '6" 2ft', "2.5' 1", '1e3'])
    assert.throws(() => parseLength(text), /Enter a length/);
});
void test('format signed feet to the nearest sixteenth, carrying rounded inches', () => {
  for (const [feet, text] of [[0,"0'"],[10,"10'"],[10.5,"10' 6\""],[16 / 12,"1' 4\""],[3.625 / 12,'3 5/8"'],[0.625 / 12,'5/8"'],[-0.5,'-6"'],[11.99 / 12,"1'"]] as const) assert.equal(formatLength(feet),text);
});
