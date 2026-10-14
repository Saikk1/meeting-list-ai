// Restore the renderer, not just the native window; never reload a dirty workspace.
export function restoreInputFocus(window) {
  if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return;
  // A modal can leave native and renderer focus flags disagreeing on Windows.
  // A real deactivate/reactivate cycle repairs that state without reloading.
  window.blur();
  window.focus();
  if (!window.webContents.isDestroyed()) window.webContents.focus();
}

export function createCloseConfirmation(window, ask, reportError = () => {}) {
  let pending = false;
  let discardApproved = false;
  return (event) => {
    if (discardApproved) {
      event.preventDefault(); // Electron requires this decision synchronously on the second close.
      return;
    }
    if (pending) return;
    pending = true;
    // The first unload remains prevented. Ask asynchronously, then retry only on approval.
    void Promise.resolve().then(() => ask(window)).then((answer) => {
      if (window.isDestroyed()) return;
      if (answer.response === 1) {
        discardApproved = true;
        window.close();
      } else {
        restoreInputFocus(window);
      }
    }).catch((error) => {
      reportError(error);
      restoreInputFocus(window);
    }).finally(() => { pending = false; });
  };
}
