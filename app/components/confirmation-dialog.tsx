"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { confirmationQueue } from "../lib/confirmation";

const serverSnapshot = () => null;

export function ConfirmationDialog() {
  const request = useSyncExternalStore(confirmationQueue.subscribe, confirmationQueue.getSnapshot, serverSnapshot);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => confirmationQueue.cancelAll(), []);
  useEffect(() => {
    if (!request) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    cancelRef.current?.focus(); // Enter must never accidentally approve a destructive action.
    return () => {
      if (dialog.open) dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [request]);

  if (!request) return null;
  function answer(accepted: boolean) {
    if (request) confirmationQueue.answer(request.id, accepted);
  }
  return <dialog ref={dialogRef} className="workspace-dialog app-confirmation-dialog"
    aria-labelledby="app-confirmation-title" aria-describedby="app-confirmation-message"
    onKeyDown={(event) => {
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      // Keep keyboard focus in the modal, including Electron's chrome-less window.
      const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
      next?.focus();
    }}
    onCancel={(event) => { event.preventDefault(); answer(false); }}>
    <h2 id="app-confirmation-title">{request.title ?? "确认操作"}</h2>
    <p id="app-confirmation-message">{request.message}</p>
    <div className="workspace-dialog__actions">
      <button type="button" ref={cancelRef} onClick={() => answer(false)}>{request.cancelLabel ?? "取消"}</button>
      <button type="button" ref={confirmRef} className="is-danger" onClick={() => answer(true)}>{request.confirmLabel ?? "确认"}</button>
    </div>
  </dialog>;
}
