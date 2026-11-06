import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Combined3dAlignment, Point } from '../core/types';
import { matchSheetAlignment } from '../core/alignment';
import DrawingCanvas from './canvas/DrawingCanvas';

export default function AlignmentEditor(props: {
  controller: WorkspaceController;
  sheetIds: readonly string[];
  onPreview: (
    draft: { sheetId: string; alignment: Combined3dAlignment } | null,
  ) => void;
  onClose: (saved?: boolean) => void;
}) {
  const initial = untrack(() => {
    const project = props.controller.project();
    if (!project) throw new Error('Open a project before aligning pages.');
    return {
      controller: props.controller,
      onPreview: props.onPreview,
      project,
      context: props.controller.captureContext(),
      expected: props.controller.observe(),
      ids: [...props.sheetIds],
    };
  });
  const sheets = () => Object.values(initial.project.sheets);
  const first = initial.ids[0] ?? sheets()[0]?.id ?? '';
  const [sheetId, setSheetId] = createSignal(first);
  const [referenceId, setReferenceId] = createSignal(
    initial.ids.find((id) => id !== first) ??
      sheets().find((sheet) => sheet.id !== first)?.id ??
      '',
  );
  const [x, setX] = createSignal(
    String(initial.project.sheets[first]?.combined3dAlignment?.offset.x ?? 0),
  );
  const [y, setY] = createSignal(
    String(initial.project.sheets[first]?.combined3dAlignment?.offset.y ?? 0),
  );
  const [angle, setAngle] = createSignal(
    String(
      ((initial.project.sheets[first]?.combined3dAlignment?.rotation ?? 0) *
        180) /
        Math.PI,
    ),
  );
  const [remove, setRemove] = createSignal(false);
  const [picking, setPicking] = createSignal<'source' | 'reference' | null>(
    null,
  );
  const [count, setCount] = createSignal(2);
  const [sourcePoints, setSourcePoints] = createSignal<Point[]>([]);
  const [referencePoints, setReferencePoints] = createSignal<Point[]>([]);
  const [match, setMatch] = createSignal<ReturnType<
    typeof matchSheetAlignment
  > | null>(null);
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  let savingNow = false;
  let dialog: HTMLDivElement | undefined;
  const numeric = createMemo(() => {
    if (
      ![x(), y(), angle()].every(
        (value) => value.trim() !== '' && Number.isFinite(Number(value)),
      )
    )
      return null;
    return {
      offset: { x: Number(x()), y: Number(y()) },
      rotation: (Number(angle()) * Math.PI) / 180,
    };
  });
  const calibrationError = createMemo(() => {
    if (!initial.project.sheets[sheetId()]?.calibration)
      return 'Calibrate the moving page before aligning it.';
    if (!initial.project.sheets[referenceId()]?.calibration)
      return 'Calibrate the reference page before matching points.';
    return '';
  });
  const restore = () => {
    initial.controller.restoreContext(initial.context);
  };
  onCleanup(restore);
  onSettled(() => {
    const previous = document.activeElement;
    dialog?.focus();
    dialog?.addEventListener('keydown', keydown);
    return () => {
      dialog?.removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  });
  function publish(value: Combined3dAlignment) {
    props.onPreview({ sheetId: sheetId(), alignment: value });
  }
  function numericChanged() {
    setError('');
    setRemove(false);
    setMatch(null);
    setSourcePoints([]);
    setReferencePoints([]);
    setPicking(null);
  }
  createEffect(
    () => ({ sheetId: sheetId(), alignment: numeric() }),
    (draft) => {
      if (draft.alignment)
        initial.onPreview({
          sheetId: draft.sheetId,
          alignment: draft.alignment,
        });
    },
    { name: 'construction.alignmentPreview' },
  );
  function setValues(value: Combined3dAlignment) {
    setX(String(value.offset.x));
    setY(String(value.offset.y));
    setAngle(String((value.rotation * 180) / Math.PI));
  }
  function changeSource(id: string) {
    props.onPreview(null);
    setSheetId(id);
    setValues(
      initial.project.sheets[id]?.combined3dAlignment ?? {
        offset: { x: 0, y: 0 },
        rotation: 0,
      },
    );
    if (id === referenceId())
      setReferenceId(sheets().find((sheet) => sheet.id !== id)?.id ?? '');
    setRemove(false);
    clearPicks();
  }
  function clearPicks() {
    setPicking(null);
    setSourcePoints([]);
    setReferencePoints([]);
    setMatch(null);
    setError('');
    restore();
  }
  function startPick() {
    clearPicks();
    if (calibrationError()) {
      setError(calibrationError());
      return;
    }
    setRemove(false);
    props.controller.setActiveSheetId(sheetId());
    setPicking('source');
  }
  function pick(point: Point) {
    const stage = picking();
    if (!stage) return;
    if (stage === 'source') {
      const next = [...sourcePoints(), point];
      setSourcePoints(next);
      if (next.length === count()) {
        props.controller.setActiveSheetId(referenceId());
        setPicking('reference');
      }
    } else {
      const next = [...referencePoints(), point];
      setReferencePoints(next);
      if (next.length !== count()) return;
      setPicking(null);
      try {
        const result = matchSheetAlignment(initial.project, {
          sheetId: sheetId(),
          referenceSheetId: referenceId(),
          sourcePoints: sourcePoints(),
          referencePoints: next,
        });
        setValues(result.alignment);
        setMatch(result);
        setError('');
        publish(result.alignment);
      } catch (cause) {
        setMatch(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      restore();
    }
  }
  async function apply() {
    const value = numeric();
    if (savingNow || !value || picking()) return;
    savingNow = true;
    setSaving(true);
    setError('');
    try {
      await props.controller.execute(
        remove()
          ? {
              name: 'construction.alignment.delete',
              payload: { sheetId: sheetId() },
            }
          : {
              name: 'construction.alignment.put',
              payload: { sheetId: sheetId(), ...value },
            },
        initial.expected,
      );
      props.onClose(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      savingNow = false;
      setSaving(false);
    }
  }
  function close() {
    if (!savingNow) props.onClose();
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === 'Tab' && dialog) {
      const items = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),canvas[tabindex]',
        ),
      ];
      const first = items[0],
        last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  return (
    <div class="alignment-backdrop">
      <div
        class="alignment-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Align pages in combined 3D"
        tabindex="-1"
        ref={(element) => {
          dialog = element;
        }}
      >
        <h2 id="alignment-title">Align pages in combined 3D</h2>
        <p>
          Offsets use metres; rotation uses degrees. Construction placement and
          takeoff points stay in their original page coordinates.
        </p>
        <fieldset disabled={saving()} class="alignment-fields">
          <label>
            Moving page
            <select
              value={sheetId()}
              onChange={(event) => {
                changeSource(event.currentTarget.value);
              }}
            >
              <For each={sheets()}>
                {(sheet) => <option value={sheet.id}>{sheet.name}</option>}
              </For>
            </select>
          </label>
          <label>
            Reference page
            <select
              value={referenceId()}
              onChange={(event) => {
                setReferenceId(event.currentTarget.value);
                clearPicks();
              }}
            >
              <For each={sheets().filter((sheet) => sheet.id !== sheetId())}>
                {(sheet) => <option value={sheet.id}>{sheet.name}</option>}
              </For>
            </select>
          </label>
          <label>
            X offset (m)
            <input
              type="number"
              step="any"
              value={x()}
              onInput={(event) => {
                setX(event.currentTarget.value);
                numericChanged();
              }}
            />
          </label>
          <label>
            Y offset (m)
            <input
              type="number"
              step="any"
              value={y()}
              onInput={(event) => {
                setY(event.currentTarget.value);
                numericChanged();
              }}
            />
          </label>
          <label>
            Rotation (degrees)
            <input
              type="number"
              step="any"
              value={angle()}
              onInput={(event) => {
                setAngle(event.currentTarget.value);
                numericChanged();
              }}
            />
          </label>
          <label>
            Point pairs
            <select
              value={count()}
              onChange={(event) => {
                setCount(Number(event.currentTarget.value));
                clearPicks();
              }}
            >
              <option value="1">One — keep saved rotation</option>
              <option value="2">Two — solve rotation and offset</option>
            </select>
          </label>
          <button
            type="button"
            onClick={startPick}
            disabled={!!calibrationError()}
          >
            Pick reference points
          </button>
          <button
            type="button"
            onClick={() => {
              clearPicks();
              setValues({ offset: { x: 0, y: 0 }, rotation: 0 });
              setRemove(true);
              publish({ offset: { x: 0, y: 0 }, rotation: 0 });
            }}
          >
            Reset alignment
          </button>
        </fieldset>
        <Show when={picking()}>
          <p role="status">
            Pick {picking() === 'source' ? 'moving' : 'reference'} page point{' '}
            {(picking() === 'source'
              ? sourcePoints().length
              : referencePoints().length) + 1}{' '}
            of {count()}. Shift bypasses snapping.
          </p>
          <div class="alignment-pick-canvas">
            <DrawingCanvas
              controller={props.controller}
              tool="select"
              onError={setError}
              onPickPoint={pick}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              clearPicks();
              restore();
            }}
          >
            Cancel point picking
          </button>
        </Show>
        <Show when={match()}>
          {(result) => (
            <div class="alignment-match" role="status">
              <Show when={result().sourceDistance !== null}>
                <p>
                  Moving distance: {result().sourceDistance?.toFixed(4)} m ·
                  Reference distance: {result().referenceDistance?.toFixed(4)} m
                </p>
              </Show>
              <p>
                Maximum residual: {result().residual.toFixed(4)} m. Review these
                distances before applying; page scale is unchanged.
              </p>
            </div>
          )}
        </Show>
        <Show when={remove()}>
          <p>Apply will remove the saved alignment for this page.</p>
        </Show>
        <Show when={calibrationError() || error() || !numeric()}>
          <p role="alert">
            {error() ||
              calibrationError() ||
              'Enter finite numbers for both offsets and rotation.'}
          </p>
        </Show>
        <div class="button-row">
          <button
            type="button"
            class="primary"
            disabled={saving() || !!picking() || !numeric()}
            onClick={() => {
              void apply();
            }}
          >
            {saving() ? 'Saving…' : 'Apply alignment'}
          </button>
          <button type="button" disabled={saving()} onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
