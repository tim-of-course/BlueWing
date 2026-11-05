import { getCurrentWebview } from '@tauri-apps/api/webview';
import { createSignal, onSettled } from 'solid-js';
import {
  pdfFileReaders,
  pdfPathReaders,
  type ImportedFileReader,
} from '../app/files';

/** Mount once to accept PDF drops anywhere in the application window. */
export function PdfDropTarget(props: {
  native: boolean;
  enabled: boolean;
  unavailableMessage: string;
  onDrop: (readers: ImportedFileReader[]) => void;
}) {
  const [dragging, setDragging] = createSignal(false);

  onSettled(() => {
    let depth = 0;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const enter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (!props.native) {
        depth++;
        setDragging(true);
      }
    };
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (!props.native && --depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (!props.native && props.enabled) {
        const readers = pdfFileReaders(Array.from(event.dataTransfer.files));
        if (readers.length) props.onDrop(readers);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    if (props.native) {
      void getCurrentWebview()
        // Native drag events are external event handlers, like the DOM handlers above.
        // eslint-disable-next-line solid/reactivity
        .onDragDropEvent(({ payload }) => {
          if (payload.type === 'enter') {
            setDragging(pdfPathReaders(payload.paths).length > 0);
          } else if (payload.type === 'leave') {
            setDragging(false);
          } else if (payload.type === 'drop') {
            setDragging(false);
            const readers = pdfPathReaders(payload.paths);
            if (props.enabled && readers.length) props.onDrop(readers);
          }
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch((error: unknown) => {
          console.error('Could not listen for PDF drops', error);
        });
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  });

  return (
    <div
      aria-hidden="true"
      style={{
        display: dragging() ? 'grid' : 'none',
        position: 'fixed',
        inset: '0',
        'z-index': '10000',
        'pointer-events': 'none',
        'place-items': 'center',
        background: 'rgba(20, 35, 50, 0.75)',
        color: 'white',
        'font-size': '1.5rem',
        'font-weight': '600',
        border: '3px dashed #80c8ff',
      }}
    >
      {props.enabled ? 'Drop PDF plans to import' : props.unavailableMessage}
    </div>
  );
}
