"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "error" | "info";

export type AppToast = {
  id: string;
  message: ReactNode;
  tone: ToastTone;
  durationMs: number;
};

function ToastItem({ toast, onDismiss }: { toast: AppToast; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const remainingMsRef = useRef(toast.durationMs);

  useEffect(() => {
    if (paused || remainingMsRef.current <= 0) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remainingMsRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAt));
    };
  }, [onDismiss, paused, toast.id]);

  return (
    <div
      className={`app-toast app-toast-${toast.tone}`}
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="app-toast-message">{toast.message}</div>
      <button
        type="button"
        className="app-toast-dismiss"
        aria-label="Dismiss notification"
        title="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        x
      </button>
    </div>
  );
}

export function AppToastViewport({ toasts, onDismiss }: { toasts: AppToast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="app-toast-viewport" aria-label="Notifications">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </div>
  );
}
