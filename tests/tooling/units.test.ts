import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

void test('product sources and documentation use imperial units', () => {
  const unit =
    /\b(?:(?:[Mm]illi|[Cc]enti|[Kk]ilo)?[Mm]et(?:er|re)s?|mm|cm|km|m2|m²)(?!\w)|\bmetresPerUnit\b|(?:\b\d+(?:\.\d+)?\s+|\bunit:\s*['"])m\b/;
  const paths = ['README.md', 'AGENTS.md'];
  for (const root of ['src', 'docs']) {
    for (const entry of readdirSync(root, {
      recursive: true,
      withFileTypes: true,
    }))
      if (entry.isFile()) paths.push(join(entry.parentPath, entry.name));
  }
  for (const path of paths) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      assert.doesNotMatch(line, unit, path + ':' + String(i + 1));
    });
  }
});
