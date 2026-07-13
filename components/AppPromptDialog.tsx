"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type PromptIntent = "default" | "danger";

export type PromptDialogRequest = {
  id: number;
  kind: "notice" | "confirm" | "prompt";
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  intent: PromptIntent;
  initialValue?: string;
  placeholder?: string;
  required?: boolean;
  validate?: (value: string) => string | null;
};

interface AppPromptDialogProps {
  request: PromptDialogRequest;
  onConfirm(value?: string): void;
  onCancel(): void;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.offsetParent !== null);
}

export function AppPromptDialog({ request, onConfirm, onCancel }: AppPromptDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(request.initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const isPrompt = request.kind === "prompt";

  useEffect(() => {
    setValue(request.initialValue ?? "");
    setError(null);
    setComposing(false);
    const target = isPrompt ? inputRef.current : request.kind === "confirm" ? cancelRef.current : confirmRef.current;
    window.setTimeout(() => {
      target?.focus();
      if (target === inputRef.current) inputRef.current?.select();
    }, 0);
  }, [isPrompt, request.id, request.initialValue, request.kind]);

  const submit = () => {
    if (!isPrompt) {
      onConfirm();
      return;
    }
    const nextError = request.required && !value.trim()
      ? "请输入内容。"
      : request.validate?.(value) ?? null;
    if (nextError) {
      setError(nextError);
      inputRef.current?.focus();
      return;
    }
    onConfirm(value);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key === "Enter" && !isPrompt) {
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const elements = focusableElements(dialogRef.current);
        if (elements.length === 0) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isPrompt, onCancel, onConfirm]);

  return (
    <div className="app-prompt-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="app-prompt-dialog"
        role={request.kind === "notice" ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.message ? descriptionId : undefined}
      >
        <div className="app-prompt-content">
          <h2 id={titleId} className="app-prompt-title">{request.title}</h2>
          {request.message && <div id={descriptionId} className="app-prompt-message">{request.message}</div>}
          {isPrompt && (
            <div className="app-prompt-input-wrap">
              <input
                ref={inputRef}
                className="app-prompt-input"
                value={value}
                placeholder={request.placeholder}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${descriptionId}-error` : undefined}
                onChange={(event) => { setValue(event.target.value); if (error) setError(null); }}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !composing && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              {error && <div id={`${descriptionId}-error`} className="app-prompt-error" role="alert">{error}</div>}
            </div>
          )}
        </div>
        <div className="app-prompt-actions">
          {request.kind !== "notice" && (
            <button ref={cancelRef} type="button" className="app-prompt-button" onClick={onCancel}>
              {request.cancelLabel ?? "取消"}
            </button>
          )}
          <button ref={confirmRef} type="button" className={`app-prompt-button app-prompt-button-primary${request.intent === "danger" ? " is-danger" : ""}`} onClick={submit}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
