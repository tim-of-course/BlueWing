import { test } from '@playwright/test';
import { namedTakeoffs } from './named-takeoffs';

test('built named takeoffs isolate UI selection, CLI, exports and reopening', async ({
  page,
}) => {
  await namedTakeoffs(page);
});
