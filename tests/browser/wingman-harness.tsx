import { render } from '@solidjs/web';
import App from '../../src/App';
import { Application } from '../../src/app/application';
import { dispatchCli } from '../../src/app/cli';
import type { CliConnection } from '../../src/app/cli-guide';
import '../../src/styles.css';

// Exercise the desktop CLI interpreter against the real UI with browser storage.
const application = new Application(false);
Object.assign(window, {
  wingmanConnection: (connection: CliConnection) => {
    application.setCliConnection(connection);
  },
  wingmanCli: (name: string, request = {}) =>
    dispatchCli(application, [name, JSON.stringify(request)]),
  wingmanCalculation: () => application.calculate(),
  wingmanWatchModelBuilds: async () => {
    const { ConstructionRenderer } = await import('../../src/three/renderer');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = ConstructionRenderer.prototype.render;
    const models = new WeakMap<
      InstanceType<typeof ConstructionRenderer>,
      Parameters<typeof original>[0]
    >();
    let builds = 0;
    ConstructionRenderer.prototype.render = function (model, options) {
      if (models.get(this) !== model) builds++;
      models.set(this, model);
      original.call(this, model, options);
    };
    return {
      builds: () => builds,
      dispose: () => {
        ConstructionRenderer.prototype.render = original;
      },
    };
  },
});
const root = document.getElementById('root');
if (root) render(() => <App application={application} />, root);
