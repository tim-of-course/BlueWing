import WingmanMenu from './WingmanMenu';
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
import ViewAnnotationEditor from './ViewAnnotationEditor';
import WingmanMessageView from './WingmanMessageView';
import type { Attachment, MessageView } from '../app/messaging';
import { groupActivity } from '../app/wingman-activity';
import WorkspacePanel, { type PanelPreferences } from './WorkspacePanel';
import WingmanTurn from './WingmanTurn';
import type {
  WingmanPresentation,
  WingmanVisual,
  ActivityTarget,
  WingmanActivity,
  WorkspaceViewSnapshot,
} from '../app/wingman-types';
import ScreenshotCapture from './ScreenshotCapture';
import { RegionImages } from '../pdf/region-images';
import './wingman.css';

interface Props {
  preferences: PanelPreferences;
  temporarilyCollapsed: boolean;
  onPinnedChange(value: boolean): void;
  onReveal(): void;
  controller: WorkspaceController;
  openTarget(target: ActivityTarget, takeoffId?: string): void;
  viewMode: WorkspaceViewSnapshot['mode'];
  canAttachView: boolean;
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
  const [entries, setEntries] = createSignal(messaging.activity);
  const [peeking, setPeeking] = createSignal(false);
  const visible = () =>
    (props.preferences.pinned() && !props.temporarilyCollapsed) || peeking();
  const [peek, setPeek] = createSignal(0);
  const replyIds = createMemo(
    () =>
      messages().flatMap((message) =>
        message.sender === 'agent' ? [message.id] : [],
      ),
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, i) => id === b[i]),
    },
  );
  const turns = createMemo(
    (previous: Map<number, WingmanActivity[]> | undefined) => {
      const grouped = groupActivity(entries(), replyIds());
      for (const [id, items] of grouped) {
        const prior = previous?.get(id);
        if (
          prior &&
          items.length === prior.length &&
          items.every((item, index) => item === prior[index])
        )
          grouped.set(id, prior);
      }
      return grouped;
    },
  );
  let transcript: HTMLDivElement | undefined;
  let composerActions: HTMLDivElement | undefined;
  let followMessages = true;
  let messageCursor = initialConversation.messages.at(-1)?.id ?? 0;
  const [lastRead, setLastRead] = createSignal(messageCursor, {
    name: 'wingman.lastRead',
  });
  onCleanup(
    messaging.subscribe((change) => {
      setConversation(messaging.status());
      if (change === 'status') return;
      if (change === 'bind' || change === 'activity')
        setEntries(messaging.activity);
      if (change === 'activity') return;
      const incoming = messaging.snapshot(
        change === 'bind' ? 0 : messageCursor,
      ).messages;
      messageCursor =
        incoming.at(-1)?.id ?? (change === 'bind' ? 0 : messageCursor);
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
        setPeeking(false);
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
  const [publication, setVisual] = createSignal<WingmanVisual | null>(null, {
    name: 'wingman.agentView',
  });
  const visual = createMemo(
    () => {
      const current = publication();
      const project = projectId();
      const takeoff = takeoffId();
      return current?.projectId === project && current.takeoffId === takeoff
        ? current
        : null;
    },
    { name: 'wingman.currentAgentView' },
  );
  const [returnView, setReturnView] =
    createSignal<WorkspaceViewSnapshot | null>(null, {
      name: 'wingman.returnView',
    });
  const [swapped, setSwapped] = createSignal(false);
  const [glowing, setGlowing] = createSignal(false);
  const [pendingView, setPendingView] = createSignal(false);
  const [changingView, setChangingView] = createSignal(false);
  const [text, setText] = createSignal('');
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [draftViews, setDraftViews] = createSignal<MessageView[]>([]);
  const [editingView, setEditingView] = createSignal<MessageView | null>(null);
  const [choosingView, setChoosingView] = createSignal(false);
  let viewingMessage = false;
  function attachView(kind: 'plan' | '3d') {
    setChoosingView(false);
    const saved = props.captureView();
    const view = kind === 'plan' ? saved?.plan : saved?.model;
    const project = props.controller.project();
    if (!saved || !view || !project) {
      setError('This view is unavailable.');
      return;
    }
    const size = view.kind === 'plan' ? view.bounds : view.frame;
    if (!size) return;
    setEditingView({
      projectId: saved.projectId,
      takeoffId: saved.takeoffId,
      revision: project.revision,
      view,
      frame: { width: size.width, height: size.height },
      annotations: [],
    });
  }
  const [capturing, setCapturing] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [promptOpen, setPromptOpen] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal('');
  const [fallbackPrompt, setFallbackPrompt] = createSignal('');
  const [now, setNow] = createSignal(Date.now(), { name: 'wingman.clock' });
  const contact = createMemo(() => {
    const current = controller.lastCliContact();
    if (current !== null) return current;
    const reply = messages()
      .filter((message) => message.sender === 'agent')
      .at(-1);
    return (
      Math.max(
        entries().at(-1)?.startedAt ?? 0,
        reply ? Date.parse(reply.createdAt) : 0,
      ) || null
    );
  });
  // The connect prompt is a setup step: close it once the AI makes contact.
  let seenContact = untrack(contact);
  createEffect(
    contact,
    (current) => {
      if (current != null && current !== seenContact) setPromptOpen(false);
      seenContact = current;
    },
    { name: 'wingman.closePromptOnContact' },
  );
  const firstConnection = () =>
    contact() == null && !messages().length && !entries().length;
  createEffect(
    contact,
    (contact) => {
      if (contact == null) return;
      const timer = setInterval(() => setNow(Date.now()), 5000);
      return () => {
        clearInterval(timer);
      };
    },
    { name: 'wingman.activityClock' },
  );
  const activity = createMemo(
    () => {
      if (conversation().paused) return 'Paused';
      if (conversation().waiting) return 'Waiting for you';
      if (controller.cliExecuting() || turns().has(0)) return 'Working';
      const last = contact();
      if (last == null) return 'Not connected';
      const seconds = Math.max(0, Math.floor((now() - last) / 1000));
      const age =
        seconds < 60
          ? `${String(seconds)}s`
          : `${String(Math.floor(seconds / 60))}m`;
      return `Idle · last active ${age} ago`;
    },
    { name: 'wingman.activity' },
  );
  let composing = false;
  let glowTimer: ReturnType<typeof setTimeout> | undefined;
  let screenshotNumber = 0;
  const unread = createMemo(() =>
    visible()
      ? 0
      : messages().filter(
          (message) => message.sender === 'agent' && message.id > lastRead(),
        ).length,
  );
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
    if (swapped() && !viewingMessage) {
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
    hasMessageDraft: () =>
      text().trim() !== '' ||
      attachments().length > 0 ||
      draftViews().length > 0 ||
      !!editingView(),
    publish,
    inspect: () => ({
      main: props.captureView(),
      agent: visual(),
      swapped: swapped(),
      expanded: visible(),
      pendingView: pendingView(),
      draftPending: props.navigationDisabled,
    }),
    flash() {
      props.onReveal();
      setPeek((value) => value + 1);
      setGlowing(true);
      clearTimeout(glowTimer);
      glowTimer = setTimeout(() => setGlowing(false), 1800);
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
        if (!capturing() && !editingView()) setCapturing(true);
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
    () => projectId(),
    () => {
      planImages.clear();
      setReturnView(null);
      setSwapped(false);
      setPendingView(false);
      setText('');
      setAttachments([]);
      setCapturing(false);
      setDraftViews([]);
      setEditingView(null);
      setChoosingView(false);
      setError('');
      setPromptOpen(false);
      setCopyStatus('');
      setFallbackPrompt('');
    },
    { name: 'wingman.project' },
  );
  createEffect(
    () => ({ open: visible(), messages: messages(), entries: entries() }),
    ({ open, messages }) => {
      if (open) setLastRead(messages.at(-1)?.id ?? 0);
      if (open && transcript && followMessages)
        transcript.scrollTop = transcript.scrollHeight;
    },
    { name: 'wingman.readConversation' },
  );
  async function openView(current: WingmanVisual) {
    if (props.navigationDisabled || changingView()) return;
    const saved = returnView() ?? props.captureView();
    if (!saved) return;
    const publishedAtClick = publication();
    viewingMessage = current.annotations !== undefined;
    await apply(current);
    if (visual() && publication() !== publishedAtClick) setPendingView(true);
    setReturnView(saved);
    setSwapped(true);
  }
  async function restore() {
    const saved = returnView();
    if (!saved || props.navigationDisabled || changingView()) return;
    await apply(saved);
    setSwapped(false);
    viewingMessage = false;
    setReturnView(null);
  }
  function turn(items: () => WingmanActivity[], endedAt?: number) {
    return (
      <WingmanTurn
        entries={items()}
        {...(endedAt === undefined ? {} : { endedAt })}
        controller={controller}
        visible={visible()}
        planImages={planImages}
        navigationDisabled={props.navigationDisabled || changingView()}
        onOpenView={(view) => {
          action(openView.bind(null, view));
        }}
        onOpenTarget={(target, takeoffId) => {
          props.openTarget(target, takeoffId);
        }}
      />
    );
  }
  function action(operation: () => Promise<unknown>) {
    void operation().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(copyTimer);
  });
  async function copyPrompt(mode: 'wingman' | 'chat') {
    const connection = props.controller.cliConnection();
    const project = props.controller.project();
    if (!connection || !project) return;
    const prompt = connectionPrompt(connection, project, mode);
    setFallbackPrompt('');
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptOpen(false);
      setCopyStatus('Prompt copied. Paste it into your AI’s chat.');
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        setCopyStatus('');
      }, 4000);
    } catch {
      clearTimeout(copyTimer);
      setCopyStatus('Could not copy. Select and copy the prompt below.');
      setFallbackPrompt(prompt);
    }
  }
  async function send() {
    if (
      sending() ||
      (!text().trim() && !attachments().length && !draftViews().length)
    )
      return;
    const projectId = props.controller.project()?.id;
    setSending(true);
    setError('');
    try {
      await messaging.send(text(), attachments(), 'user', draftViews());
      if (projectId === props.controller.project()?.id) {
        setText('');
        setAttachments([]);
        setDraftViews([]);
      }
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <Show when={props.controller.project()}>
        <WorkspacePanel
          name="wingman"
          label="Wingman"
          side="right"
          preferences={props.preferences}
          temporarilyCollapsed={props.temporarilyCollapsed}
          onPinnedChange={(value) => {
            props.onPinnedChange(value);
          }}
          bottomControl
          bottomControlHost={() => composerActions}
          unread={unread()}
          peekState={[peeking, setPeeking]}
          peekRequest={peek()}
        >
          <div
            class={[
              'wingman',
              glowing() && 'wingman-glowing',
              conversation().paused && 'wingman-paused',
            ]}
          >
            <div class="wingman-header">
              <strong>Wingman</strong>
              <span
                class="wingman-status"
                role="status"
                data-status={activity().split(' ')[0]}
              >
                {activity()}
              </span>
              <button
                type="button"
                class="wingman-icon"
                aria-label={conversation().paused ? 'Resume CLI' : 'Pause CLI'}
                title={conversation().paused ? 'Resume CLI' : 'Pause CLI'}
                onClick={() => {
                  messaging.setPaused(!conversation().paused);
                }}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d={
                      conversation().paused
                        ? 'M4 2v12l9-6z'
                        : 'M4 3h3v10H4zM9 3h3v10H9z'
                    }
                  />
                </svg>
              </button>
              <WingmanMenu
                waiting={conversation().waiting}
                onCopyPrompt={() => setPromptOpen((v) => !v)}
                onEnd={() => {
                  messaging.stopWaiting();
                }}
              />
            </div>
            <Show when={conversation().paused}>
              <p class="wingman-pause-note">
                CLI paused. A running action may finish.
              </p>
            </Show>
            <Show when={copyStatus()}>
              <p class="wingman-pause-note" role="status">
                {copyStatus()}
              </p>
            </Show>
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
                  <div class="wingman-prompt-choices">
                    <button
                      type="button"
                      onClick={() => {
                        void copyPrompt('wingman');
                      }}
                    >
                      Wingman + chat
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void copyPrompt('chat');
                      }}
                    >
                      Chat only
                    </button>
                  </div>
                  <p>
                    Wingman + chat: talk here or in your AI’s chat. Chat only:
                    keep the conversation in your AI’s chat.
                  </p>
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
            <Show when={swapped()}>
              <button
                type="button"
                disabled={props.navigationDisabled || changingView()}
                onClick={() => {
                  action(restore);
                }}
              >
                Return to your view
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

            <section class="wingman-chat" aria-label="Wingman conversation">
              <div
                class="wingman-messages"
                ref={(element) => {
                  transcript = element;
                  followMessages = true;
                }}
                onScroll={(event) => {
                  const log = event.currentTarget;
                  followMessages =
                    log.scrollHeight - log.scrollTop - log.clientHeight <= 4;
                }}
                role="log"
                aria-label="Messages"
                aria-live="polite"
              >
                <Show when={!messages().length && !entries().length}>
                  <div class="wingman-empty">
                    <p>
                      Messages are saved here. Your AI sees them on its next
                      Bluewing command.
                    </p>
                    <Show when={firstConnection()}>
                      <button
                        type="button"
                        class="primary"
                        aria-expanded={promptOpen() ? 'true' : 'false'}
                        onClick={() => setPromptOpen((open) => !open)}
                      >
                        Copy AI prompt
                      </button>
                    </Show>
                  </div>
                </Show>
                <For each={messages()}>
                  {(message) => (
                    <>
                      <Show when={turns().get(message.id)}>
                        {(items) => turn(items, Date.parse(message.createdAt))}
                      </Show>
                      <article
                        class={[
                          'wingman-message',
                          `wingman-message-${message.sender}`,
                        ]}
                      >
                        <span class="wingman-speaker">
                          {message.sender === 'user' ? 'You' : 'AI'}
                        </span>
                        <p>{message.text}</p>
                        <For each={message.views}>
                          {(view) => (
                            <WingmanMessageView
                              view={view}
                              controller={controller}
                              planImages={planImages}
                              visible={visible()}
                              disabled={
                                props.navigationDisabled || changingView()
                              }
                              onOpen={(current) => {
                                action(openView.bind(null, current));
                              }}
                            />
                          )}
                        </For>
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
                    </>
                  )}
                </For>
                <Show when={turns().get(0)}>{(items) => turn(items)}</Show>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  action(send);
                }}
              >
                <textarea
                  aria-label="Message"
                  value={text()}
                  readonly={sending()}
                  placeholder="Ask a question or give a correction…"
                  onInput={(event) => setText(event.currentTarget.value)}
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
                <div class="wingman-attachments">
                  <For each={draftViews()}>
                    {(view) => (
                      <div>
                        <img src={view.image?.dataUrl} alt={view.image?.name} />
                        <button
                          type="button"
                          aria-label={`Remove ${view.image?.name ?? 'view'}`}
                          disabled={sending()}
                          onClick={() =>
                            setDraftViews((items) =>
                              items.filter((item) => item !== view),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
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
                <div class="wingman-compose-actions" ref={composerActions}>
                  <button
                    type="button"
                    class="wingman-icon"
                    title="Attach screenshot"
                    aria-label="Attach screenshot"
                    disabled={sending()}
                    onClick={() => setCapturing(true)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      aria-hidden="true"
                    >
                      <path d="M2.5 6.5h3l1.5-2h6l1.5 2h3v10h-15z" />
                      <circle cx="10" cy="11" r="3" />
                    </svg>
                  </button>
                  <div class="wingman-view-action">
                    <button
                      type="button"
                      class="wingman-icon"
                      aria-label="Attach view"
                      title="Attach view"
                      disabled={sending() || !props.canAttachView}
                      onClick={() => {
                        const mode = props.viewMode;
                        if (mode === 'split')
                          setChoosingView((value) => !value);
                        else attachView(mode);
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        aria-hidden="true"
                      >
                        <path d="M2 3h13v10H2z M4 11l3-4 3 3 2-2 M15 11v7m-3.5-3.5h7" />
                      </svg>
                    </button>
                    <Show when={props.viewMode === 'split' && choosingView()}>
                      <div class="wingman-view-choice">
                        <button
                          type="button"
                          onClick={() => {
                            attachView('plan');
                          }}
                        >
                          Plan
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            attachView('3d');
                          }}
                        >
                          3D
                        </button>
                      </div>
                    </Show>
                  </div>
                  <button
                    type="submit"
                    class="wingman-icon wingman-send"
                    aria-label="Send"
                    title="Enter to send · Shift+Enter for a new line"
                    disabled={
                      sending() ||
                      (!text().trim() &&
                        !attachments().length &&
                        !draftViews().length)
                    }
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M10 16V4m-5 5 5-5 5 5" />
                    </svg>
                  </button>
                </div>
              </form>
            </section>
            <Show
              when={
                error() ||
                conversation().loadError ||
                conversation().activityError
              }
            >
              {(problem) => (
                <p class="wingman-error" role="alert">
                  {problem()}
                </p>
              )}
            </Show>
          </div>
        </WorkspacePanel>
      </Show>
      <Show when={editingView()}>
        {(view) => (
          <ViewAnnotationEditor
            view={view()}
            controller={controller}
            planImages={planImages}
            onCancel={() => setEditingView(null)}
            onDone={(saved) => {
              setDraftViews((items) => [...items, saved]);
              setEditingView(null);
              props.onPinnedChange(true);
              setPeek((value) => value + 1);
            }}
          />
        )}
      </Show>
      <Show when={capturing()}>
        <ScreenshotCapture
          onCancel={() => setCapturing(false)}
          onError={(message) => {
            setError(message);
            setCapturing(false);
            props.onPinnedChange(true);
            setPeek((value) => value + 1);
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
            props.onPinnedChange(true);
            setPeek((value) => value + 1);
          }}
        />
      </Show>
    </>
  );
}
