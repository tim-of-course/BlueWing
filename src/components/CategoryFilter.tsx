import { For } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import { categoryOptions } from '../core/categories';

export default function CategoryFilter(props: {
  controller: WorkspaceController;
}) {
  const options = () => {
    const project = props.controller.project();
    return project ? categoryOptions(project) : [];
  };
  function toggle(value: string | null, checked: boolean) {
    const current = props.controller.categoryFilter();
    const next = current === undefined ? [] : [...current];
    props.controller.setCategoryFilter(
      checked ? [...next, value] : next.filter((item) => item !== value),
    );
  }
  return (
    <details class="category-filter" style={{ position: 'relative' }}>
      <summary>
        Categories{props.controller.categoryFilter() === undefined ? '' : ' •'}
      </summary>
      <div
        style={{
          position: 'absolute',
          'z-index': '20',
          background: '#fff',
          color: '#172334',
          padding: '0.6rem',
          'min-width': '16rem',
          'box-shadow': '0 2px 8px #0004',
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={props.controller.categoryFilter() === undefined}
            onChange={() => {
              props.controller.setCategoryFilter(undefined);
            }}
          />{' '}
          All
        </label>
        <For each={options()} keyed={(option) => option.name}>
          {(option) => (
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                aria-label={option().name}
                checked={
                  props.controller.categoryFilter()?.includes(option().name) ??
                  false
                }
                onChange={(event) => {
                  toggle(option().name, event.currentTarget.checked);
                }}
              />{' '}
              <span aria-hidden="true" style={{ color: option().color }}>
                ●
              </span>{' '}
              {option().name}
            </label>
          )}
        </For>
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={props.controller.categoryFilter()?.includes(null) ?? false}
            onChange={(event) => {
              toggle(null, event.currentTarget.checked);
            }}
          />{' '}
          Uncategorized
        </label>
        <button
          type="button"
          onClick={() => {
            props.controller.setCategoryFilter([]);
          }}
        >
          Clear
        </button>
      </div>
    </details>
  );
}
