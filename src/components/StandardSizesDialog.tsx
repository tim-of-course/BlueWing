import { createSignal, onSettled, untrack } from 'solid-js';
import { formatLength, parseLength } from '../core/length';
import type { StandardSizes } from '../core/standard-sizes';

export default function StandardSizesDialog(props: {
  title: string;
  sizes: StandardSizes;
  save: (sizes: StandardSizes) => Promise<void>;
  close: () => void;
}) {
  const initial = untrack(() => props.sizes);
  const [stud, setStud] = createSignal(
    initial.studLengths.map(formatLength).join(', '),
  );
  const [track, setTrack] = createSignal(
    initial.trackLengths.map(formatLength).join(', '),
  );
  const [sheets, setSheets] = createSignal(
    initial.sheets
      .map((s) => formatLength(s.width) + ' x ' + formatLength(s.length))
      .join('\n'),
  );
  const [batts, setBatts] = createSignal(
    initial.batts.map((b) => b.name + ' | ' + String(b.coverage)).join('\n'),
  );
  const [minimum, setMinimum] = createSignal(
    String(initial.specialOrderMinimum),
  );
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  let dialog!: HTMLDialogElement;
  onSettled(() => {
    dialog.showModal();
  });
  async function save() {
    try {
      setSaving(true);
      const lengths = (s: string) =>
        s.split(',').map((v) => parseLength(v.trim()));
      await props.save({
        studLengths: lengths(stud()),
        trackLengths: lengths(track()),
        sheets: sheets()
          .trim()
          .split('\n')
          .map((line) => {
            const parts = line.split(/\s*[x×]\s*/);
            if (parts.length !== 2)
              throw new Error('Enter each sheet as width x length.');
            return {
              width: parseLength(parts[0] ?? ''),
              length: parseLength(parts[1] ?? ''),
            };
          }),
        batts: batts()
          .trim()
          .split('\n')
          .map((line) => {
            const parts = line.split('|');
            if (parts.length !== 2)
              throw new Error('Enter each batt as name | SF per bag.');
            return {
              name: (parts[0] ?? '').trim(),
              coverage: Number(parts[1]),
            };
          }),
        specialOrderMinimum: Number(minimum()),
      });
      props.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-label={props.title}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving()) props.close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3>{props.title}</h3>
        <fieldset disabled={saving()}>
          <label>
            Stud lengths (comma separated)
            <input
              value={stud()}
              onInput={(e) => setStud(e.currentTarget.value)}
            />
          </label>
          <label>
            Track lengths (comma separated)
            <input
              value={track()}
              onInput={(e) => setTrack(e.currentTarget.value)}
            />
          </label>
          <label>
            Sheets (width x length per line)
            <textarea
              rows={5}
              value={sheets()}
              onInput={(e) => setSheets(e.currentTarget.value)}
            />
          </label>
          <label>
            Batts (product | SF per bag per line)
            <textarea
              rows={4}
              value={batts()}
              onInput={(e) => setBatts(e.currentTarget.value)}
            />
          </label>
          <label>
            Special-order stud minimum
            <input
              type="number"
              min="1"
              step="1"
              value={minimum()}
              onInput={(e) => setMinimum(e.currentTarget.value)}
            />
          </label>
        </fieldset>
        <p role="alert">{error()}</p>
        <button type="submit" disabled={saving()}>
          Save sizes
        </button>
        <button
          type="button"
          disabled={saving()}
          onClick={() => {
            props.close();
          }}
        >
          Cancel
        </button>
      </form>
    </dialog>
  );
}
