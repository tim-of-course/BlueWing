import { spawn } from 'node:child_process';

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

const args = process.argv.slice(2);
// Keep the sibling CLI advertised by the development desktop in sync too.
const cliExit = await run('cargo', [
  'build',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '--locked',
  '--bin',
  'bluewing',
  ...(args.includes('--release') ? ['--release'] : []),
]);
if (cliExit !== 0) process.exit(cliExit);

process.exitCode = await run(process.execPath, [
  'x',
  '--no-install',
  'tauri',
  'dev',
  ...args,
]);
