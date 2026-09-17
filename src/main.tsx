import { render } from '@solidjs/web';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Bluewing mount element is missing.');

render(() => <App />, root);
