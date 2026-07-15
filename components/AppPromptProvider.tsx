"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppPromptDialog, type PromptDialogRequest, type PromptIntent } from "./AppPromptDialog";
import { AppToastViewport, type AppToast, type ToastTone } from "./AppToastViewport";

export type BasePromptOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: PromptIntent;
};

export type ConfirmChoiceOptions = BasePromptOptions & {
  secondaryConfirmLabel: string;
  secondaryIntent?: "default" | "success" | "danger";
};

export type ConfirmChoiceResult = "confirm" | "secondary" | null;

export type PromptInputOptions = BasePromptOptions & {
  initialValue?: string;
  placeholder?: string;
  required?: boolean;
  validate?: (value: string) => string | null;
};

export type ToastOptions = {
  message: ReactNode;
  tone?: ToastTone;
  durationMs?: number;
};

export type AppPromptApi = {
  notice(options: Omit<BasePromptOptions, "cancelLabel">): Promise<void>;
  confirm(options: BasePromptOptions): Promise<boolean>;
  confirmChoice(options: ConfirmChoiceOptions): Promise<ConfirmChoiceResult>;
  prompt(options: PromptInputOptions): Promise<string | null>;
  toast(options: ToastOptions): string;
  dismissToast(id: string): void;
};

type QueuedRequest = PromptDialogRequest & {
  trigger: HTMLElement | null;
  settled: boolean;
  resolve(value: boolean | string | null | undefined): void;
};

const PromptContext = createContext<AppPromptApi | null>(null);

function restoreFocus(element: HTMLElement | null) {
  if (element?.isConnected && !element.hasAttribute("disabled")) element.focus();
}

export function AppPromptProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedRequest[]>([]);
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const queueRef = useRef<QueuedRequest[]>([]);
  const nextIdRef = useRef(1);
  const nextToastIdRef = useRef(1);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const enqueue = useCallback((request: Omit<PromptDialogRequest, "id">) => new Promise<boolean | string | null | undefined>((resolve) => {
    const activeElement = document.activeElement;
    const queued: QueuedRequest = {
      ...request,
      id: nextIdRef.current++,
      trigger: activeElement instanceof HTMLElement ? activeElement : null,
      settled: false,
      resolve,
    };
    setQueue((current) => {
      const next = [...current, queued];
      queueRef.current = next;
      return next;
    });
  }), []);

  const notice = useCallback(async (options: Omit<BasePromptOptions, "cancelLabel">) => {
    await enqueue({
      kind: "notice",
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "知道了",
      intent: options.intent ?? "default",
    });
  }, [enqueue]);

  const confirm = useCallback(async (options: BasePromptOptions) => Boolean(await enqueue({
    kind: "confirm",
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel ?? "确认",
    cancelLabel: options.cancelLabel ?? "取消",
    intent: options.intent ?? "default",
  })), [enqueue]);

  const confirmChoice = useCallback(async (options: ConfirmChoiceOptions): Promise<ConfirmChoiceResult> => {
    const result = await enqueue({
      kind: "confirm",
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "确认",
      cancelLabel: options.cancelLabel ?? "取消",
      intent: options.intent ?? "default",
      secondaryConfirmLabel: options.secondaryConfirmLabel,
      secondaryIntent: options.secondaryIntent ?? "default",
    });
    return result === "secondary" ? "secondary" : result === true ? "confirm" : null;
  }, [enqueue]);

  const prompt = useCallback(async (options: PromptInputOptions) => {
    const result = await enqueue({
      kind: "prompt",
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "确认",
      cancelLabel: options.cancelLabel ?? "取消",
      intent: options.intent ?? "default",
      initialValue: options.initialValue,
      placeholder: options.placeholder,
      required: options.required,
      validate: options.validate,
    });
    return typeof result === "string" ? result : null;
  }, [enqueue]);

  const toast = useCallback((options: ToastOptions) => {
    const id = `toast-${nextToastIdRef.current++}`;
    const nextToast: AppToast = {
      id,
      message: options.message,
      tone: options.tone ?? "info",
      durationMs: options.durationMs ?? 5000,
    };
    setToasts((current) => [...current, nextToast].slice(-3));
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const settle = useCallback((request: QueuedRequest, value: boolean | string | null | undefined) => {
    if (request.settled) return;
    request.settled = true;
    request.resolve(value);
    restoreFocus(request.trigger);
    setQueue((current) => {
      const next = current.filter((candidate) => candidate.id !== request.id);
      queueRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => () => {
    for (const request of queueRef.current) {
      if (request.settled) continue;
      request.settled = true;
      request.resolve(request.kind === "confirm" ? false : request.kind === "prompt" ? null : undefined);
    }
  }, []);

  const active = queue[0];

  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.querySelector<HTMLElement>(".app-shell-root");
    const previousInert = appRoot?.inert;
    document.body.style.overflow = "hidden";
    if (appRoot) appRoot.inert = true;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = previousInert ?? false;
    };
  }, [active]);

  const api: AppPromptApi = { notice, confirm, confirmChoice, prompt, toast, dismissToast };

  return (
    <PromptContext.Provider value={api}>
      {children}
      {typeof document !== "undefined" && createPortal(
        <>
          {active && (
            <AppPromptDialog
              request={active}
              onConfirm={(value) => settle(active, active.kind === "prompt" ? value ?? "" : active.kind === "confirm" ? true : undefined)}
              onSecondaryConfirm={() => settle(active, "secondary")}
              onCancel={() => settle(active, active.kind === "confirm" ? false : active.kind === "prompt" ? null : undefined)}
            />
          )}
          <AppToastViewport toasts={toasts} onDismiss={dismissToast} />
        </>,
        document.body,
      )}
    </PromptContext.Provider>
  );
}

export function usePrompt(): AppPromptApi {
  const context = useContext(PromptContext);
  if (!context) throw new Error("usePrompt must be used within AppPromptProvider");
  return context;
}
