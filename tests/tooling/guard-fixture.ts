import { existsSync } from 'node:fs';
import {
  acquireSlot,
  blockedExitCode,
  runGuarded,
} from '../../scripts/resources';

const mode = process.argv[2];
const port = Number(process.argv[3]);
const marker = process.argv[4] ?? '';
const healthy = {
  memoryBytes: 4 * 1024 ** 3,
  memoryMetric: 'available' as const,
  pressure: 1,
  load: 1,
  cores: 8,
};
try {
  if (mode === 'hold') {
    const slot = await acquireSlot('fixture holder', 0);
    console.log(JSON.stringify({ port: slot.port, token: slot.token }));
  } else {
    let command = [
      process.execPath,
      '-e',
      'process.exit(process.env.CARGO_BUILD_JOBS === "1" ? 7 : 99)',
    ];
    if (mode === 'nested')
      command = [process.execPath, import.meta.filename, 'exit', String(port)];
    if (mode === 'pressure' || mode === 'interrupt')
      command = [
        process.execPath,
        '-e',
        `
      process.on('SIGTERM', () => {});
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ parent: process.pid, child: child.pid }));
      setInterval(() => {}, 1000);
    `,
      ];
    if (mode === 'blocked' || mode === 'compete')
      command = [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`,
      ];
    if (mode === 'warning-start' || mode === 'warning-runtime')
      command = [
        process.execPath,
        '-e',
        `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'completed'); process.exit(7); }, 200)`,
      ];
    let samples = 0;
    const code = await runGuarded(command, {
      port,
      intervalMs: 30,
      sample: () => {
        samples++;
        return Promise.resolve(
          mode === 'blocked' || (mode === 'pressure' && existsSync(marker))
            ? { ...healthy, pressure: 4 }
            : mode === 'warning-start' ||
                (mode === 'warning-runtime' && samples > 1)
              ? { ...healthy, pressure: 2 }
              : healthy,
        );
      },
    });
    process.exitCode = code;
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = blockedExitCode;
}
