import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, relative } from 'node:path';

const version = process.argv[2];
if (!version || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
  throw new Error('Usage: bun run web:release <version>');
}
const versionName = version.replace(/\.+$/, '').toLowerCase();
if (versionName === '0.1.0' || versionName === 'active') {
  throw new Error('Web version is reserved; use a new version');
}
const output = join('output', 'web');
const destination = join(output, version);
if (lstatSync(destination, { throwIfNoEntry: false })) {
  throw new Error('Web version already exists; use a new version');
}
execFileSync('bun', ['run', 'build'], { stdio: 'inherit' });
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(output, '.release-'));
const files: { path: string; sha256: string; size: number }[] = [];
async function collect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name !== 'manifest.json') {
      const content = await readFile(path);
      files.push({
        path: relative(temporary, path).split('\\').join('/'),
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.length,
      });
    }
  }
}
try {
  await cp('dist', temporary, { recursive: true });
  // The release marker lets native verification distinguish installed web versions.
  await writeFile(
    join(temporary, 'release.json'),
    JSON.stringify({ version, bridgeVersion: 9, projectFormats: [10] }),
  );
  await collect(temporary);
  await writeFile(
    join(temporary, 'manifest.json'),
    JSON.stringify(
      { version, bridgeVersion: 9, projectFormats: [10], files },
      null,
      2,
    ),
  );
  await rename(temporary, destination);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(
  `Web release ${version}: ${destination}/manifest.json (${String(files.length)} files)`,
);
