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
});
const root = document.getElementById('root');
if (root) render(() => <App application={application} />, root);
