import { createSignal, onSettled, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { MessageView } from '../app/messaging';
import type { RegionImages } from '../pdf/region-images';
import ViewInk from './ViewInk';
import WingmanPreview from './WingmanPreview';

export default function WingmanMessageView(props: {
  view: MessageView;
  controller: WorkspaceController;
  planImages: RegionImages;
  visible: boolean;
  disabled: boolean;
  onOpen(view: MessageView): void;
}) {
  let button!: HTMLButtonElement;
  const [onscreen, setOnscreen] = createSignal(false);
  onSettled(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setOnscreen(!!entry?.isIntersecting),
      { root: button.closest('[role="log"]') },
    );
    observer.observe(button);
    return () => {
      observer.disconnect();
    };
  });
  const caption = () =>
    props.view.caption ||
    (props.view.view.kind === 'plan'
      ? (props.controller.project()?.sheets[props.view.view.sheetId]?.name ??
        'Plan view')
      : '3D view');
  const available = () =>
    props.controller.project()?.takeoffs[props.view.takeoffId] &&
    (props.view.view.kind === '3d' ||
      props.controller.project()?.sheets[props.view.view.sheetId]);
  return (
    <button
      ref={button}
      type="button"
      class="wingman-message-view"
      style={{
        '--view-ratio': String(
          props.view.frame.width / props.view.frame.height,
        ),
      }}
      disabled={props.disabled || !available()}
      aria-label={`Open view: ${caption()}`}
      onClick={() => {
        props.onOpen(props.view);
      }}
    >
      <div class="wingman-view-media">
        <Show when={props.visible && onscreen()}>
          <WingmanPreview
            controller={props.controller}
            planImages={props.planImages}
            takeoffId={props.view.takeoffId}
            frame={props.view.frame}
            view={props.view.view}
          />
          <ViewInk
            class="wingman-thumbnail-ink"
            shapes={props.view.annotations}
          />
        </Show>
      </div>
      <span class="wingman-caption">{caption()}</span>
    </button>
  );
}
