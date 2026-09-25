import type { FullConfig } from '@playwright/test';
import { requireResourceGuard } from '../../scripts/resources';

export default async function setup(config: FullConfig): Promise<void> {
  if (config.workers !== 1)
    throw new Error(
      'Bluewing browser tests require one worker. Remove the --workers override.',
    );
  await requireResourceGuard();
}
