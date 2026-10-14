export type ConfirmationOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ConfirmationRequest = ConfirmationOptions & { id: number };

// No blocking browser/OS dialogs: one modal owns focus at a time.
export class ConfirmationQueue {
  private nextId = 0;
  private pending: { request: ConfirmationRequest; resolve: (answer: boolean) => void }[] = [];
  private listeners = new Set<() => void>();

  getSnapshot = (): ConfirmationRequest | null => this.pending[0]?.request ?? null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private notify() { for (const listener of this.listeners) listener(); }

  ask(options: string | ConfirmationOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending.push({ request: { ...(typeof options === "string" ? { message: options } : options), id: ++this.nextId }, resolve });
      this.notify();
    });
  }
  answer(id: number, accepted: boolean) {
    if (this.pending[0]?.request.id !== id) return;
    const current = this.pending.shift()!;
    current.resolve(accepted);
    this.notify();
  }
  cancelAll() {
    const pending = this.pending;
    this.pending = [];
    for (const item of pending) item.resolve(false);
    this.notify();
  }
}

export const confirmationQueue = new ConfirmationQueue();
export function confirmAction(options: string | ConfirmationOptions) {
  return confirmationQueue.ask(options);
}
