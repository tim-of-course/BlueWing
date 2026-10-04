import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { cpus, freemem, loadavg, platform, totalmem } from 'node:os';
import { promisify } from 'node:util';

// One OS-owned slot for every Bluewing checkout on this host. No stale lock files.
export const resourcePort = 47631;
export const tokenVariable = 'BLUEWING_HEAVY_TOKEN';
export const blockedExitCode = 75;
const gib = 1024 ** 3;
const execute = promisify(execFile);

export interface Resources {
  memoryBytes: number;
  memoryMetric: 'available' | 'non-compressed-pool';
  pressure: number;
  load: number;
  cores: number;
}
export function parseMacResources(
  pressure: string,
  memory: string,
): Pick<Resources, 'memoryBytes' | 'memoryMetric' | 'pressure'> {
  const percent = /System-wide memory free percentage:\s*(\d+)%/.exec(
    memory,
  )?.[1];
  const bytes = /^The system has\s+(\d+)(?:\s|$)/m.exec(memory)?.[1];
  const level = Number(pressure.trim());
  if (!percent || !bytes || ![1, 2, 4].includes(level))
    throw new Error(
      'Cannot read macOS memory pressure; heavy work was not started.',
    );
  return {
    // This kernel pool includes active pages, not just unused or reclaimable RAM.
    memoryBytes: (Number(bytes) * Number(percent)) / 100,
    memoryMetric: 'non-compressed-pool',
    pressure: level,
  };
}
export async function sampleResources(): Promise<Resources> {
  let memory: Pick<Resources, 'memoryBytes' | 'memoryMetric' | 'pressure'> = {
    memoryBytes: freemem(),
    memoryMetric: 'available',
    pressure: 1,
  };
  if (platform() === 'darwin') {
    const [pressure, free] = await Promise.all([
      execute(
        '/usr/sbin/sysctl',
        ['-n', 'kern.memorystatus_vm_pressure_level'],
        { timeout: 2000 },
      ),
      execute('/usr/bin/memory_pressure', ['-Q'], { timeout: 2000 }),
    ]);
    memory = parseMacResources(pressure.stdout, free.stdout);
  } else if (platform() === 'linux') {
    const available = /^MemAvailable:\s+(\d+) kB$/m.exec(
      await readFile('/proc/meminfo', 'utf8'),
    )?.[1];
    if (!available)
      throw new Error(
        'Cannot read available memory; heavy work was not started.',
      );
    memory.memoryBytes = Number(available) * 1024;
  }
  return { ...memory, load: loadavg()[0] ?? 0, cores: cpus().length };
}
export function resourceProblem(
  resources: Resources,
  starting: boolean,
): string | null {
  if (resources.pressure === 4) return 'macOS memory pressure is critical';
  const minimum = starting ? 2 * gib : gib;
  if (resources.memoryBytes < minimum)
    return `only ${(resources.memoryBytes / gib).toFixed(1)} GiB ${resources.memoryMetric === 'non-compressed-pool' ? 'in the macOS non-compressed memory pool' : 'available'}; ${starting ? '2' : '1'} GiB required`;
  if (starting && resources.load > resources.cores * 2)
    return `system load ${resources.load.toFixed(1)} exceeds twice the ${String(resources.cores)} CPU cores`;
  return null;
}
function resourceWarning(resources: Resources): string | null {
  return resources.pressure === 2
    ? 'macOS memory pressure is warning. Critical pressure will still stop heavy work.'
    : null;
}
interface Owner {
  pid: number;
  command: string;
  directory: string;
}
interface SlotReply {
  authorized: boolean;
  owner: Owner;
}
export function inspectSlot(
  token = '',
  port = resourcePort,
): Promise<SlotReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () =>
      socket.destroy(new Error('Resource guard did not respond.')),
    );
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`${token}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4096)
        socket.destroy(new Error('Invalid resource guard response.'));
    });
    socket.on('end', () => {
      try {
        resolve(JSON.parse(buffer) as SlotReply);
      } catch {
        reject(
          new Error('Resource guard port is occupied by another service.'),
        );
      }
    });
  });
}
export async function requireResourceGuard(port = resourcePort): Promise<void> {
  const token = process.env[tokenVariable];
  if (!token)
    throw new Error(
      'Use the guarded bun run test:* scripts (see README.md). Direct heavy-test execution is disabled.',
    );
  const reply = await inspectSlot(token, port);
  if (!reply.authorized)
    throw new Error(
      'The parent resource guard is no longer valid. Restart using the guarded command.',
    );
}
export async function acquireSlot(command: string, port = resourcePort) {
  const token = randomUUID();
  const owner: Owner = { pid: process.pid, command, directory: process.cwd() };
  const server = createServer((socket) => {
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.once('data', (data) => {
      socket.end(
        JSON.stringify({ authorized: data.toString().trim() === token, owner }),
      );
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
    });
  } catch {
    const other = await inspectSlot('', port).catch(() => null);
    throw new Error(
      other
        ? `Another Bluewing heavy job is running: ${other.owner.command} (PID ${String(other.owner.pid)}, ${other.owner.directory}). Wait for it to finish.`
        : `Bluewing's shared resource port ${String(port)} is occupied. Heavy work was not started.`,
    );
  }
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing resource guard address.');
  return {
    port: address.port,
    token,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}
interface RunOptions {
  sample?: () => Promise<Resources>;
  intervalMs?: number;
  port?: number;
}
/** Runs only the requested process tree; a resource stop is never a test pass. */
export async function runGuarded(
  command: string[],
  options: RunOptions = {},
): Promise<number> {
  const [program, ...args] = command;
  if (!program)
    throw new Error('Usage: bun scripts/heavy.ts -- <command> [arguments]');
  const nested = Boolean(process.env[tokenVariable]);
  if (nested) await requireResourceGuard(options.port);
  const slot = nested
    ? null
    : await acquireSlot(command.join(' '), options.port);
  const sample = options.sample ?? sampleResources;
  let warned = false;
  const warnOnce = (resources: Resources) => {
    const warning = resourceWarning(resources);
    if (warning && !warned) {
      console.warn(`[resource guard] ${warning}`);
      warned = true;
    }
  };
  try {
    if (!nested) {
      const resources = await sample();
      const problem = resourceProblem(resources, true);
      if (problem)
        throw new Error(
          `Heavy work blocked: ${problem}. Retry after resources recover.`,
        );
      warnOnce(resources);
    }
    const child = spawn(program, args, {
      stdio: 'inherit',
      detached: !nested && platform() !== 'win32',
      env: {
        ...process.env,
        CARGO_BUILD_JOBS: '1',
        [tokenVariable]: slot?.token ?? process.env[tokenVariable],
      },
    });
    const status: { stopped: number | null } = { stopped: null };
    let checking = false;
    let finished = false;
    let stopping: Promise<void> | undefined;
    let descendants: number[] = [];
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const collectDescendants = async () => {
      if (!child.pid || platform() === 'win32' || nested) return;
      const result = await execute('ps', ['-axo', 'pid=,ppid='], {
        timeout: 2000,
      });
      const rows = result.stdout
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number));
      const parents = new Set([child.pid]);
      for (;;) {
        const count = parents.size;
        for (const [pid, parent] of rows)
          if (pid && parent && parents.has(parent)) parents.add(pid);
        if (parents.size === count) break;
      }
      descendants = [...parents].filter((pid) => pid !== child.pid);
    };
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      if (!nested && platform() === 'win32') {
        const killer = spawn(
          'taskkill',
          ['/pid', String(child.pid), '/T', '/F'],
          { stdio: 'ignore' },
        );
        killer.on('error', () => child.kill(signal));
      } else {
        for (const pid of descendants) {
          try {
            process.kill(pid, signal);
          } catch {
            /* Descendant already exited. */
          }
        }
        try {
          if (nested) child.kill(signal);
          else process.kill(-child.pid, signal);
        } catch {
          /* Process tree already exited. */
        }
      }
    };
    const stop = (code: number, reason: string) => {
      if (status.stopped !== null || finished) return;
      status.stopped = code;
      console.error(`[resource guard] Stopping heavy work: ${reason}`);
      stopping = collectDescendants()
        .catch(() => {
          /* Process group remains available if ps fails. */
        })
        .then(() => {
          kill('SIGTERM');
          escalation = setTimeout(() => {
            kill('SIGKILL');
          }, 1000);
        });
    };
    const interrupt = () => {
      stop(130, 'interrupted');
    };
    const terminate = () => {
      stop(143, 'terminated');
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const timer = nested
      ? undefined
      : setInterval(() => {
          if (checking || status.stopped !== null) return;
          checking = true;
          void sample()
            .then((resources) => {
              const problem = resourceProblem(resources, false);
              if (problem) stop(blockedExitCode, problem);
              else warnOnce(resources);
            })
            .catch((error: unknown) => {
              stop(blockedExitCode, String(error));
            })
            .finally(() => {
              checking = false;
            });
        }, options.intervalMs ?? 3000);
    try {
      const code = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
          resolve(code ?? (signal ? 1 : 0));
        });
      });
      return status.stopped ?? code;
    } finally {
      finished = true;
      clearInterval(timer);
      await stopping;
      clearTimeout(escalation);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      // Reap leftover descendants before admitting another heavy job.
      if (!nested) kill('SIGKILL');
    }
  } finally {
    await slot?.close();
  }
}
export async function printResourceStatus(): Promise<void> {
  const resources = await sampleResources();
  console.log(
    JSON.stringify(
      {
        ...resources,
        totalBytes: totalmem(),
        problem: resourceProblem(resources, true),
        warning: resourceWarning(resources),
        running: (await inspectSlot().catch(() => null))?.owner ?? null,
      },
      null,
      2,
    ),
  );
}
