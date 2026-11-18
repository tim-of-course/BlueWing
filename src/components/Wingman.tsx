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
import { connectionPrompt } from '../app/cli-guide';
import type { Attachment } from '../app/messaging';
import { visibleDrawingIds } from '../app/visibility';
import type {
  WingmanPresentation,
  WingmanVisual,
  WingmanView,
  WorkspaceViewSnapshot,
} from '../app/wingman-types';
import ScreenshotCapture from './ScreenshotCapture';
import WingmanPreview from './WingmanPreview';
import { RegionImages } from '../pdf/region-images';
import './wingman.css';

interface Props {
  controller: WorkspaceController;
  captureView(): WorkspaceViewSnapshot | null;
  applyView(view: WorkspaceViewSnapshot | WingmanVisual): Promise<void>;
  navigationDisabled: boolean;
}

export default function Wingman(props: Props) {
  const controller = untrack(() => props.controller);
  const planImages = new RegionImages((sheet, bounds, dimension, signal) =>
    controller.renderRegion(sheet, bounds, dimension, signal),
  );
  onCleanup(() => {
    planImages.clear();
  });
  const messaging = untrack(() => props.controller.messaging);
  const initialConversation = messaging.snapshot();
  const [conversation, setConversation] = createSignal(messaging.status(), {
    name: 'wingman.conversation',
  });
  const [messages, setMessages] = createSignal(initialConversation.messages, {
    name: 'wingman.messages',
  });
  let transcript: HTMLDivElement | undefined;
  let followMessages = true;
  let messageCursor = initialConversation.messages.at(-1)?.id ?? 0;
  const [lastRead, setLastRead] = createSignal(messageCursor, {
    name: 'wingman.lastRead',
  });
  onCleanup(
    messaging.subscribe((change) => {
      setConversation(messaging.status());
      if (change === 'status') return;
      const incoming = messaging.snapshot(
        change === 'bind' ? 0 : messageCursor,
      ).messages;
      messageCursor = incoming.at(-1)?.id ?? 0;
      // Measure before the new rows change the height of the log.
      const distanceFromBottom = transcript
        ? transcript.scrollHeight -
          transcript.scrollTop -
          transcript.clientHeight
        : 0;
      followMessages =
        change === 'bind' ||
        distanceFromBottom <= 4 ||
        incoming.some((message) => message.sender === 'user');
      if (change === 'bind') {
        // The conversation rebinds whenever the project opens, closes or switches.
        setVisual(null);
        setLastRead(messageCursor);
        setMessages(incoming);
      } else setMessages((previous) => [...previous, ...incoming]);
    }),
  );
  const projectId = createMemo(() => props.controller.project()?.id ?? null);
  // A memo only notifies when the takeoff changes, not on every project edit.
  const takeoffId = createMemo(
    () => props.controller.project()?.takeoffId ?? null,
    { name: 'wingman.takeoffId' },
  );
  const [publishedVisual, setVisual] = createSignal<WingmanVisual | null>(
    null,
    { name: 'wingman.agentView' },
  );
  // A view published for another project or takeoff is never shown, including
  // in the frame before the switch clears it.
  const visual = createMemo(
    () => {
      const published = publishedVisual();
      return published?.projectId === projectId() &&
        published.takeoffId === takeoffId()
        ? published
        : null;
    },
    { name: 'wingman.currentAgentView' },
  );
  const [returnView, setReturnView] =
    createSignal<WorkspaceViewSnapshot | null>(null, {
      name: 'wingman.returnView',
    });
  const [swapped, setSwapped] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [chatOpen, setChatOpen] = createSignal(false);
  const [glowing, setGlowing] = createSignal(false);
  const [pendingView, setPendingView] = createSignal(false);
  const [changingView, setChangingView] = createSignal(false);
  const [text, setText] = createSignal('');
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [capturing, setCapturing] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [promptOpen, setPromptOpen] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal('');
  const [fallbackPrompt, setFallbackPrompt] = createSignal('');
  const [now, setNow] = createSignal(Date.now(), { name: 'wingman.clock' });
  createEffect(
    controller.lastCliContact,
    (contact) => {
      if (contact === null) return;
      const timer = setInterval(() => setNow(Date.now()), 5000);
      return () => {
        clearInterval(timer);
      };
    },
    { name: 'wingman.activityClock' },
  );
  const activity = createMemo(
    () => {
      if (controller.cliExecuting()) return 'AI is working';
      const contact = controller.lastCliContact();
      if (contact === null) return 'No AI connected yet';
      const seconds = Math.max(0, Math.floor((now() - contact) / 1000));
      const age =
        seconds < 60
          ? `${String(seconds)} s`
          : `${String(Math.floor(seconds / 60))} min`;
      return `AI last active ${age} ago`;
    },
    { name: 'wingman.activity' },
  );
  let composing = false;
  let glowTimer: ReturnType<typeof setTimeout> | undefined;
  let screenshotNumber = 0;
  const unread = createMemo(() =>
    chatOpen()
      ? 0
      : messages().filter(
          (message) => message.sender === 'agent' && message.id > lastRead(),
        ).length,
  );
  const preview = createMemo<WingmanView | null>(() => {
    if (!swapped()) return visual()?.view ?? null;
    const saved = returnView();
    if (saved?.mode === '3d') return saved.model;
    return saved?.plan
      ? {
          ...saved.plan,
          visibleGeometryIds: [
            ...visibleDrawingIds(
              props.controller.project(),
              saved.context.visibility,
              saved.context.categories,
            ),
          ],
        }
      : (saved?.model ?? null);
  });
  const title = createMemo(() => {
    if (swapped())
      return returnView()?.quantities ? 'Your quantities view' : 'Your view';
    const current = visual();
    if (current?.caption) return current.caption;
    if (current?.view.kind === 'plan')
      return (
        props.controller.project()?.sheets[current.view.sheetId]?.name ??
        'Plan unavailable'
      );
    return current ? 'Construction · 3D' : 'Your AI’s view will appear here';
  });
  async function apply(view: WorkspaceViewSnapshot | WingmanVisual) {
    setChangingView(true);
    setError('');
    try {
      await props.applyView(view);
      if ('context' in view || view === visual()) setPendingView(false);
    } finally {
      setChangingView(false);
    }
  }
  function publish(next: WingmanVisual) {
    if (next.projectId !== props.controller.project()?.id) return false;
    if (next.takeoffId !== props.controller.project()?.takeoffId) return false;
    const current = structuredClone(next);
    setVisual(current);
    if (swapped()) {
      if (props.navigationDisabled || changingView()) setPendingView(true);
      else
        void apply(current).catch((cause: unknown) => {
          setPendingView(true);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }
    return true;
  }
  const presentation: WingmanPresentation = {
    hasMessageDraft: () => text().trim() !== '' || attachments().length > 0,
    publish,
    inspect: () => ({
      main: props.captureView(),
      agent: visual(),
      swapped: swapped(),
      expanded: expanded(),
      pendingView: pendingView(),
      draftPending: props.navigationDisabled,
    }),
    flash() {
      setExpanded(true);
      setGlowing(true);
      clearTimeout(glowTimer);
      glowTimer = setTimeout(() => setGlowing(false), 1800);
    },
    annotate(annotations, highlightIds) {
      const current = visual();
      if (!current || current.view.kind !== 'plan')
        throw new Error('Render a plan view before adding plan annotations');
      const sheetId = current.view.sheetId;
      const project = props.controller.project();
      const sheet = project?.sheets[sheetId];
      if (!sheet) throw new Error('The source sheet is no longer available');
      if (
        highlightIds?.some((id) => project.geometries[id]?.sheetId !== sheetId)
      )
        throw new Error('Highlights must belong to the displayed sheet');
      if (
        annotations.some(
          (item) =>
            !item.points.length ||
            item.points.some(
              (point) =>
                point.x < 0 ||
                point.y < 0 ||
                point.x > sheet.width ||
                point.y > sheet.height,
            ),
        )
      )
        throw new Error('Annotation points must fit the displayed sheet');
      publish({
        ...current,
        view: {
          ...current.view,
          annotations,
          ...(highlightIds ? { highlightIds } : {}),
        },
      });
    },
  };
  onSettled(() => {
    props.controller.setPresentation(presentation);
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'x' &&
        props.controller.project()
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!capturing()) setCapturing(true);
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      props.controller.setPresentation(undefined);
      window.removeEventListener('keydown', keydown, true);
      clearTimeout(glowTimer);
    };
  });
  createEffect(
    () => takeoffId(),
    () => {
      planImages.clear();
      setReturnView(null);
      setSwapped(false);
      setPendingView(false);
    },
    { name: 'wingman.takeoff' },
  );
  createEffect(
    () => projectId(),
    () => {
      planImages.clear();
      setReturnView(null);
      setSwapped(false);
      setPendingView(false);
      setText('');
      setAttachments([]);
      setCapturing(false);
      setError('');
      setPromptOpen(false);
      setCopyStatus('');
      setFallbackPrompt('');
    },
    { name: 'wingman.project' },
  );
  createEffect(
    () => ({ open: chatOpen(), messages: messages() }),
    ({ open }) => {
      if (open && transcript && followMessages)
        transcript.scrollTop = transcript.scrollHeight;
    },
    { name: 'wingman.readConversation' },
  );
  async function swap() {
    if (props.navigationDisabled || changingView()) return;
    if (swapped()) {
      const saved = returnView();
      if (!saved) return;
      await apply(saved);
      setSwapped(false);
      setReturnView(null);
    } else {
      const current = visual();
      const saved = props.captureView();
      if (!current || !saved) return;
      await apply(current);
      setReturnView(saved);
      setSwapped(true);
      if (visual() !== current) setPendingView(true);
    }
  }
  function action(operation: () => Promise<unknown>) {
    void operation().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }
  async function copyPrompt(mode: 'wingman' | 'chat') {
    const connection = props.controller.cliConnection();
    const project = props.controller.project();
    if (!connection || !project) return;
    const prompt = connectionPrompt(connection, project, mode);
    setFallbackPrompt('');
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyStatus('Prompt copied. Paste it into your AI’s chat.');
    } catch {
      setCopyStatus('Could not copy. Select and copy the prompt below.');
      setFallbackPrompt(prompt);
    }
  }
  async function send() {
    if (sending() || (!text().trim() && !attachments().length)) return;
    const projectId = props.controller.project()?.id;
    setSending(true);
    setError('');
    try {
      await messaging.send(text(), attachments(), 'user');
      if (projectId === props.controller.project()?.id) {
        setText('');
        setAttachments([]);
      }
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <Show when={props.controller.project()}>
        <aside
          class={[
            'wingman',
            chatOpen() && 'wingman-chat-open',
            glowing() && 'wingman-glowing',
            conversation().paused && 'wingman-paused',
          ]}
          aria-label="Wingman"
        >
          <Show when={chatOpen()}>
            <section class="wingman-chat" aria-label="Wingman conversation">
              <div class="wingman-chat-title">
                <strong>Conversation</strong>
                <span>
                  {conversation().waiting ? 'With your AI' : activity()}
                </span>
              </div>
              <div
                class="wingman-messages"
                ref={(element) => {
                  transcript = element;
                  followMessages = true;
                }}
                role="log"
                aria-label="Messages"
                aria-live="polite"
              >
                <Show when={!messages().length}>
                  <p class="wingman-empty">
                    Messages are saved here. Your AI sees them on its next
                    Bluewing command.
                  </p>
                </Show>
                <For each={messages()}>
                  {(message) => (
                    <article
                      class={[
                        'wingman-message',
                        `wingman-message-${message.sender}`,
                      ]}
                    >
                      <strong>
                        {message.sender === 'user' ? 'You' : 'AI'}
                      </strong>
                      <p>{message.text}</p>
                      <div class="wingman-message-images">
                        <For each={message.attachments}>
                          {(attachment) => (
                            <Show
                              when={!attachment.unavailable}
                              fallback={
                                <span class="wingman-empty">
                                  {attachment.name} (image unavailable)
                                </span>
                              }
                            >
                              <a
                                href={attachment.dataUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="Open screenshot"
                              >
                                <img
                                  src={attachment.dataUrl}
                                  alt={attachment.name}
                                />
                              </a>
                            </Show>
                          )}
                        </For>
                      </div>
                    </article>
                  )}
                </For>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  action(send);
                }}
              >
                <label for="wingman-message">Message</label>
                <textarea
                  id="wingman-message"
                  value={text()}
                  readonly={sending()}
                  placeholder="Ask a question or give a correction…"
                  onInput={(event) => setText(event.currentTarget.value)}
                  aria-describedby="wingman-keyboard-hint"
                  onCompositionStart={() => {
                    composing = true;
                  }}
                  onCompositionEnd={() => {
                    composing = false;
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.isComposing &&
                      !composing &&
                      // WebKit can clear isComposing before the IME's final Enter.
                      // eslint-disable-next-line @typescript-eslint/no-deprecated
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      if (!event.repeat) action(send);
                    }
                  }}
                />
                <p id="wingman-keyboard-hint" class="wingman-keyboard-hint">
                  Enter to send · Shift+Enter for a new line
                </p>
                <div class="wingman-attachments">
                  <For each={attachments()}>
                    {(attachment) => (
                      <div>
                        <img src={attachment.dataUrl} alt={attachment.name} />
                        <button
                          type="button"
                          aria-label={`Remove ${attachment.name}`}
                          disabled={sending()}
                          onClick={() =>
                            setAttachments((items) =>
                              items.filter((item) => item.id !== attachment.id),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
                <div class="wingman-compose-actions">
                  <button
                    type="button"
                    title="Attach screenshot (Cmd/Ctrl+Shift+X)"
                    disabled={sending()}
                    onClick={() => setCapturing(true)}
                  >
                    Attach screenshot
                  </button>
                  <button
                    type="submit"
                    disabled={
                      sending() || (!text().trim() && !attachments().length)
                    }
                  >
                    {sending() ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </section>
          </Show>
          <div class="wingman-header">
            <button
              type="button"
              aria-label={
                expanded() ? 'Collapse Wingman view' : 'Expand Wingman view'
              }
              aria-expanded={expanded() ? 'true' : 'false'}
              onClick={() => setExpanded((value) => !value)}
            >
              Wingman {expanded() ? '▾' : '▴'}
            </button>
            <button
              type="button"
              aria-label="Wingman chat"
              aria-expanded={chatOpen() ? 'true' : 'false'}
              onClick={() => {
                setLastRead(messages().at(-1)?.id ?? 0);
                setChatOpen((value) => !value);
              }}
            >
              Chat{unread() ? ` (${String(unread())})` : ''}
            </button>
            <button
              type="button"
              class={conversation().paused ? 'wingman-resume' : ''}
              onClick={() => {
                messaging.setPaused(!conversation().paused);
              }}
            >
              {conversation().paused ? 'Resume CLI' : 'Pause CLI'}
            </button>
          </div>
          <div class="wingman-connect">
            <button
              type="button"
              aria-expanded={promptOpen() ? 'true' : 'false'}
              onClick={() => setPromptOpen((open) => !open)}
            >
              Copy AI prompt
            </button>
          </div>
          <Show when={promptOpen()}>
            <section class="wingman-prompts" aria-label="Connect your AI">
              <Show
                when={props.controller.cliConnection()}
                fallback={
                  <p>
                    Connecting an AI needs the Bluewing desktop app. Open this
                    project there to copy a connection prompt.
                  </p>
                }
              >
                <p>Copy a prompt and paste it into your AI’s chat.</p>
                <button
                  type="button"
                  onClick={() => {
                    void copyPrompt('wingman');
                  }}
                >
                  Wingman + chat
                </button>
                <p>Talk here or in your AI’s chat.</p>
                <button
                  type="button"
                  onClick={() => {
                    void copyPrompt('chat');
                  }}
                >
                  Chat only
                </button>
                <p>Keep the conversation in your AI’s chat.</p>
                <Show when={copyStatus()}>
                  <p role="status">{copyStatus()}</p>
                </Show>
                <Show when={fallbackPrompt()}>
                  <label for="wingman-prompt">AI connection prompt</label>
                  <textarea
                    id="wingman-prompt"
                    readonly
                    value={fallbackPrompt()}
                    onFocus={(event) => {
                      event.currentTarget.select();
                    }}
                  />
                </Show>
              </Show>
            </section>
          </Show>
          <Show
            when={conversation().waiting}
            fallback={
              // With the chat open the same line is in its title, so the
              // transcript keeps its height.
              <Show when={!chatOpen()}>
                <div class="wingman-swap-hint">{activity()}</div>
              </Show>
            }
          >
            <div class="wingman-waiting">
              <span role="status">Waiting for your message</span>
              <button
                type="button"
                onClick={() => {
                  messaging.stopWaiting();
                }}
              >
                End conversation
              </button>
            </div>
          </Show>
          <Show when={conversation().paused}>
            <p class="wingman-pause-note" role="status">
              AI actions paused. An action already running may finish.
            </p>
          </Show>
          <Show when={expanded()}>
            <button
              type="button"
              class="wingman-swap"
              aria-label={
                swapped() ? 'Return to your view' : 'Swap to agent view'
              }
              disabled={!visual() || props.navigationDisabled || changingView()}
              onClick={() => {
                action(swap);
              }}
            >
              <Show
                when={preview()}
                fallback={
                  <div class="wingman-empty">
                    Views shared by your AI will appear here.
                  </div>
                }
              >
                {(current) => (
                  <WingmanPreview
                    controller={props.controller}
                    view={current()}
                    planImages={planImages}
                  />
                )}
              </Show>
              <span class="wingman-caption">{title()}</span>
              <Show when={visual()}>
                <span class="wingman-swap-hint">
                  {props.navigationDisabled
                    ? 'Finish your edit to swap views'
                    : swapped()
                      ? 'Click to return to your view'
                      : 'Click to swap views'}
                </span>
              </Show>
            </button>
            <Show when={pendingView()}>
              <button
                type="button"
                disabled={props.navigationDisabled || changingView()}
                onClick={() => {
                  const current = visual();
                  if (current) action(() => apply(current));
                }}
              >
                Show latest agent view
              </button>
            </Show>
          </Show>
          <Show when={error() || conversation().loadError}>
            {(problem) => (
              <p class="wingman-error" role="alert">
                {problem()}
              </p>
            )}
          </Show>
        </aside>
      </Show>
      <Show when={capturing()}>
        <ScreenshotCapture
          onCancel={() => setCapturing(false)}
          onError={(message) => {
            setError(message);
            setCapturing(false);
            setChatOpen(true);
          }}
          onCapture={(capture) => {
            setAttachments((items) => [
              ...items,
              {
                ...capture,
                id: crypto.randomUUID(),
                name: `Screenshot ${String(++screenshotNumber)}`,
              },
            ]);
            setCapturing(false);
            setChatOpen(true);
          }}
        />
      </Show>
    </>
  );
}
