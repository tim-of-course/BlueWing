import { render } from '@solidjs/web';
import App from '../../src/App';
import { Application } from '../../src/app/application';
import { dispatchCli } from '../../src/app/cli';
import type { CliConnection } from '../../src/app/cli-guide';
import type { WingmanVisual } from '../../src/app/wingman-types';
import '../../src/styles.css';

// Exercise the desktop CLI interpreter against the real UI with browser storage.
const application = new Application(false);
Object.assign(window, {
  wingmanConnection: (connection: CliConnection) => {
    application.setCliConnection(connection);
  },
  wingmanCli: (name: string, request = {}) =>
    dispatchCli(application, [name, JSON.stringify(request)]),
  wingmanPublish: (visual: WingmanVisual) =>
    application.presentation?.publish(visual),
  holdNextProjectSave() {
    const save = application.storage.save.bind(application.storage);
    let release!: (fail: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    application.storage.save = async (...args) => {
      application.storage.save = save;
      if (await gate) throw new Error('Test save failed');
      await save(...args);
    };
    return release;
  },
  wingmanHoldLibraryRead: () => {
    const read = application.libraryStore.read.bind(application.libraryStore);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    application.libraryStore.read = async () => {
      await gate;
      return read();
    };
    return () => {
      application.libraryStore.read = read;
      release();
    };
  },
  wingmanCalculation: () => application.calculate(),
  wingmanPerformance: () => application.performance.report(),
  wingmanWatchModelBuilds: async () => {
    const { ConstructionRenderer } = await import('../../src/three/renderer');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = ConstructionRenderer.prototype['setModel'];
    const builds = { viewer: 0, preview: 0 };
    ConstructionRenderer.prototype['setModel'] = function (model) {
      original.call(this, model);
      // The viewer owns a mounted canvas. After the exports, only Wingman uses the offscreen renderer.
      if (this['canvas'].isConnected) builds.viewer++;
      else builds.preview++;
    };
    return {
      builds: () => ({ ...builds }),
      dispose: () => {
        ConstructionRenderer.prototype['setModel'] = original;
      },
    };
  },
});
const root = document.getElementById('root');
if (root) render(() => <App application={application} />, root);
