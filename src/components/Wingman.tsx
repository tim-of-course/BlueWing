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
import './wingman.css';

interface Props {
  controller: WorkspaceController;
  captureView(): WorkspaceViewSnapshot | null;
  applyView(view: WorkspaceViewSnapshot | WingmanVisual): Promise<void>;
  navigationDisabled: boolean;
}

export default function Wingman(props: Props) {
  const messaging = untrack(() => props.controller.messaging);
  const [conversation, setConversation] = createSignal(messaging.snapshot(), {
    name: 'wingman.conversation',
  });
  onCleanup(messaging.subscribe(() => setConversation(messaging.snapshot())));
  const [visual, setVisual] = createSignal<WingmanVisual | null>(null, {
    name: 'wingman.agentView',
  });
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
  const [lastRead, setLastRead] = createSignal(0);
  const [promptOpen, setPromptOpen] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal('');
  const [fallbackPrompt, setFallbackPrompt] = createSignal('');
  let composing = false;
  let glowTimer: ReturnType<typeof setTimeout> | undefined;
  let transcript: HTMLDivElement | undefined;
  let screenshotNumber = 0;
  const unread = createMemo(() =>
    chatOpen()
      ? 0
      : conversation().messages.filter(
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
      setPendingView(false);
    } finally {
      setChangingView(false);
    }
  }
  function publish(next: WingmanVisual) {
    if (next.projectId !== props.controller.project()?.id) return;
    setVisual(structuredClone(next));
    if (swapped()) {
      if (props.navigationDisabled || changingView()) setPendingView(true);
      else
        void apply(next).catch((cause: unknown) => {
          setPendingView(true);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }
  }
  const presentation: WingmanPresentation = {
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
  const projectId = createMemo(() => props.controller.project()?.id ?? null);
  createEffect(
    () => projectId(),
    () => {
      setVisual(null);
      setReturnView(null);
      setSwapped(false);
      setPendingView(false);
      setText('');
      setAttachments([]);
      setCapturing(false);
      setError('');
      setLastRead(0);
      setPromptOpen(false);
      setCopyStatus('');
      setFallbackPrompt('');
    },
    { name: 'wingman.project' },
  );
  createEffect(
    () => ({ open: chatOpen(), messages: conversation().messages }),
    ({ open }) => {
      if (open) {
        if (transcript) transcript.scrollTop = transcript.scrollHeight;
      }
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
                <span>With your AI</span>
              </div>
              <div
                class="wingman-messages"
                ref={(element) => {
                  transcript = element;
                }}
                role="log"
                aria-label="Messages"
                aria-live="polite"
              >
                <Show when={!conversation().messages.length}>
                  <p class="wingman-empty">
                    Send a message or attach a screenshot for your connected AI.
                  </p>
                </Show>
                <For each={conversation().messages}>
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
                  disabled={sending()}
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
                setLastRead(conversation().messages.at(-1)?.id ?? 0);
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
          <Show when={conversation().waiting}>
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
          <Show when={error()}>
            <p class="wingman-error" role="alert">
              {error()}
            </p>
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
