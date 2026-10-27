// Revisions survive Activity's effect teardown, so resumed pages also re-read data.
function createChangeSignal() {
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => revision,
    getServerSnapshot: () => 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notify() {
      revision += 1;
      for (const listener of listeners) listener();
    },
  };
}

export const contactsChanges = createChangeSignal();
export const adminConfigChanges = createChangeSignal();
