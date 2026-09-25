import { blockedExitCode, printResourceStatus, runGuarded } from './resources';

try {
  if (process.argv[2] === '--check') await printResourceStatus();
  else {
    const args = process.argv.slice(2);
    if (args[0] === '--') args.shift();
    process.exitCode = await runGuarded(args);
  }
} catch (error) {
  console.error(
    `[resource guard] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = blockedExitCode;
}
