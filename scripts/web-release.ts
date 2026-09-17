import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const version = process.argv[2];
if (!version || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
  throw new Error('Usage: bun run web:release <version>');
}
const destination = join('output', 'web', version);
// The release marker lets native verification distinguish installed web versions.
execFileSync('bun', ['run', 'build'], { stdio: 'inherit' });
await mkdir(join('output', 'web'), { recursive: true });
await mkdir(destination);
await cp('dist', destination, { recursive: true });
await writeFile(
  join(destination, 'release.json'),
  JSON.stringify({ version, bridgeVersion: 1 }),
);
const files: { path: string; sha256: string; size: number }[] = [];
async function collect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name !== 'manifest.json') {
      const content = await readFile(path);
      files.push({
        path: relative(destination, path).split('\\').join('/'),
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.length,
      });
    }
  }
}
await collect(destination);
await writeFile(
  join(destination, 'manifest.json'),
  JSON.stringify({ version, bridgeVersion: 1, files }, null, 2),
);
console.log(
  `Web release ${version}: ${destination}/manifest.json (${String(files.length)} files)`,
);
