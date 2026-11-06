import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Application } from '../../src/app/application';
import { parseCli } from '../../src/app/cli';
import { registry } from '../../src/app/registry';
import { ProjectSession } from '../../src/core/session';
import { estiMakerTakeoff } from '../../src/core/quantity-presentation';
import { fixture } from '../fixtures/quantity-project';

void test('registry CLI command saves exact shared JSON text with no save/revision/cache mutation; UI dialog can cancel', async () => {
  const project = fixture();
  let saves = 0;
  const app = new Application(true);
  app.session = new ProjectSession(project, {
    save: () => {
      saves++;
      return Promise.resolve();
    },
  });
  const snapshot = app.calculate();
  const original = structuredClone(app.project);
  const definition = registry.find(
    (entry) => entry.name === 'quantities.exportEstiMaker',
  );
  assert.ok(definition);
  assert.equal(definition.mutates, false);
  const files: { path: string; text: string }[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke(command: string, args: { path: string; data: string }) {
          if (command === 'plugin:dialog|save') return Promise.resolve(null);
          assert.equal(command, 'write_file');
          files.push({
            path: args.path,
            text: Buffer.from(args.data, 'base64').toString('utf8'),
          });
          return Promise.resolve();
        },
      },
    },
  });
  try {
    await assert.rejects(
      app.dispatch(parseCli(['quantities.exportEstiMaker'])),
      /explicit output path/,
    );
    const result = await app.dispatch(
      parseCli([
        'quantities.exportEstiMaker',
        JSON.stringify({ payload: { path: 'C:/exports/estimate.json' } }),
      ]),
    );
    const data = result.data as { path: string; text: string };
    assert.equal(files.length, 1);
    assert.equal(files[0]?.path, 'C:/exports/estimate.json');
    assert.equal(files[0].text, data.text);
    const parsed = JSON.parse(data.text) as { exportedAt: string };
    assert.deepEqual(
      JSON.parse(data.text),
      estiMakerTakeoff(project, snapshot, parsed.exportedAt),
    );
    assert.equal(result.revision, original?.revision);
    assert.equal(saves, 0);
    assert.deepEqual(app.project, original);
    assert.equal(app.calculate(), snapshot);
    const canceled = await app.dispatch({
      name: 'quantities.exportEstiMaker',
      origin: 'ui',
    });
    assert.equal((canceled.data as { path: null }).path, null);
    assert.equal(files.length, 1);
    const broken = fixture();
    const recipe = broken.recipes.tee;
    if (!recipe?.outputs[0]) throw new Error('Missing fixture output');
    recipe.outputs[0].formula = 'unknown';
    app.session = new ProjectSession(broken, { save: () => Promise.resolve() });
    await assert.rejects(
      app.dispatch(
        parseCli([
          'quantities.exportEstiMaker',
          JSON.stringify({ payload: { path: 'C:/exports/broken.json' } }),
        ]),
      ),
      /Cannot export to EstiMaker/,
    );
    assert.equal(
      files.length,
      1,
      'producer errors must not save a partial or fabricated file',
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
