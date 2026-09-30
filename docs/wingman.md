# Wingman implementation

Wingman gives a user and an external CLI participant a shared visual and a small project conversation. Bluewing does not run a model or an agent.

Implementation checkpoints:

1. Project messaging, retained screenshots, message delivery in CLI replies, bounded waiting, and user-owned Pause/Resume that rejects queued CLI actions.
2. Live plan/3D Wingman previews, view swapping with a preserved return view, captions, temporary annotations, and flash that expands the preview.
3. Chat UI and app-wide screenshot selection, followed by guarded browser and native verification.

The screenshot shortcut captures a rectangle anywhere inside the app, including headers, sidebars, plans, and 3D. Captures remain in the message draft until sent and can be removed or supplemented. Sent images stay fixed.

CLI messages are delivered as text with image paths, including on application errors. Message reads do not remove history. Callers report their last received message so concurrent calls or a lost response cannot consume another caller's messages. Chat saves separately from estimate revision and Undo.

Pause blocks new non-messaging CLI actions and rejects queued actions that have not started. A running atomic action can finish. Resuming never replays rejected actions. Desktop editing and messaging remain available.

Verification results will be recorded here after implementation.
