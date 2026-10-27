"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

export function notifySaved(message: string) {
  window.dispatchEvent(new CustomEvent("app-saved", { detail: message }));
}

export function AppFeedback() {
  const [notice, setNotice] = useState<{ message: string; id: number } | null>(
    null,
  );
  useEffect(() => {
    const receive = (event: Event) => {
      const message = (event as CustomEvent).detail;
      if (typeof message === "string") setNotice({ message, id: Date.now() });
    };
    window.addEventListener("app-saved", receive);
    return () => window.removeEventListener("app-saved", receive);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div className="app-feedback-region" role="status" aria-live="polite">
      {notice && (
        <div className="app-feedback">
          <CheckCircle2 size={18} />
          <span>{notice.message}</span>
          <button
            aria-label="关闭保存提示"
            type="button"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
