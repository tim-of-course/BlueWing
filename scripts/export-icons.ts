import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'assets/brand/bluewing.svg');
const native = join(root, 'src-tauri/icons');
const web = join(root, 'public/brand');
const temporary = await mkdtemp(join(tmpdir(), 'bluewing-icons-'));
const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');

function generate(args: string[]): void {
  // A fresh CLI process avoids reinitializing Tauri's process-global logger.
  execFileSync(process.execPath, [cli, 'icon', source, ...args], {
    stdio: 'inherit',
  });
}

try {
  // Tauri also generates mobile/store assets; only copy the desktop icons we use.
  const generatedNative = join(temporary, 'native');
  const generatedWeb = join(temporary, 'web');
  generate(['--output', generatedNative]);
  generate(['--output', generatedWeb, '--png', '16,32']);

  await mkdir(native, { recursive: true });
  await mkdir(web, { recursive: true });
  for (const name of [
    '32x32.png',
    '128x128.png',
    '128x128@2x.png',
    'icon.png',
    'icon.ico',
    'icon.icns',
  ]) {
    await copyFile(join(generatedNative, name), join(native, name));
  }
  await copyFile(source, join(web, 'bluewing.svg'));
  await copyFile(join(generatedNative, 'icon.ico'), join(web, 'favicon.ico'));
  for (const size of [16, 32]) {
    await copyFile(
      join(generatedWeb, `${String(size)}x${String(size)}.png`),
      join(web, `favicon-${String(size)}.png`),
    );
  }
  console.log('Exported Bluewing icons to public/brand and src-tauri/icons.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
