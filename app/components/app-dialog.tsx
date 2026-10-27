"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Shared modal behavior: native focus containment, Escape and focus restoration. */
export function AppDialog({
  children,
  className,
  labelledBy,
  describedBy,
  onClose,
  busy = false,
  assistantEnabled = false,
}: {
  children: ReactNode;
  className: string;
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  busy?: boolean;
  assistantEnabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-dialog-focus]")?.focus();
    return () => {
      dialog?.close();
      document.documentElement.style.overflow = overflow;
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous.getClientRects().length
      )
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      data-assistant-dialog={assistantEnabled ? "true" : undefined}
      className={className}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
