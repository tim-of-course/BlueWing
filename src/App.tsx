import { createSignal } from 'solid-js';

export default function App() {
  const [sheetsVisible, setSheetsVisible] = createSignal(true, {
    name: 'workspace.sheetsVisible',
  });

  return (
    <div class="workspace">
      <header class="workspace-header">
        <strong>Bluewing</strong>
        <button
          type="button"
          aria-controls="sheet-navigator"
          aria-expanded={sheetsVisible() ? 'true' : 'false'}
          onClick={() => setSheetsVisible((visible) => !visible)}
        >
          Sheets
        </button>
      </header>
      <div class="workspace-body">
        <aside
          id="sheet-navigator"
          aria-label="Sheets"
          hidden={!sheetsVisible()}
        >
          <h2>Sheets</h2>
          <p>No sheets loaded</p>
        </aside>
        <main>
          <div class="empty-workspace">
            <h1>No project open</h1>
            <p>Your plans and takeoff will appear here.</p>
          </div>
        </main>
      </div>
      <footer>No project open</footer>
    </div>
  );
}
