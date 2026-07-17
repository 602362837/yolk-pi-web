import type { AuthEvent, AuthPrompt, AuthInteraction, Credential } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { sanitizeAntigravityLoginError } from "@/lib/antigravity-account-token";
import {
  ANTIGRAVITY_PROVIDER_ID,
  isSupportedOAuthAccountProvider,
  saveOAuthAccountCredential,
  syncActiveOAuthAccountCredential,
} from "@/lib/oauth-accounts";
import { reloadRpcAuthState } from "@/lib/rpc-manager";
import { createInMemoryWebCredentialStore } from "@/lib/web-credential-store";
import { createWebModelRuntime, getWebModelRuntime } from "@/lib/web-model-runtime";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

function providerHasOAuth(provider: { auth?: { oauth?: unknown } } | undefined): boolean {
  return Boolean(provider?.auth?.oauth);
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
  if (!token.startsWith(`${provider}-`)) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const accountMode = new URL(req.url).searchParams.get("accountMode");
  const addAccountMode = accountMode === "add";

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // AbortController propagates client disconnect into runtime.login()
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      if (accountMode && accountMode !== "add") {
        send(controller, { type: "error", message: `Unsupported account mode: ${accountMode}` });
        controller.close();
        return;
      }
      if (addAccountMode && !isSupportedOAuthAccountProvider(provider)) {
        send(controller, { type: "error", message: `Account add mode is not supported for ${provider}` });
        controller.close();
        return;
      }

      // Fixed providers (Grok/Kiro/Antigravity) register on the target runtime.
      // add-account uses an isolated in-memory credential store so Active is untouched.
      const agentDir = getAgentDir();
      const memoryCredentials = addAccountMode ? createInMemoryWebCredentialStore() : undefined;
      const runtime = addAccountMode
        ? await createWebModelRuntime({
            agentDir,
            credentials: memoryCredentials,
          })
        : await getWebModelRuntime({ agentDir });

      // Ensure fixed extension providers are present on the admin runtime.
      // getWebModelRuntime already registers them; createWebModelRuntime for
      // add-account needs an explicit fixed-provider load.
      if (addAccountMode) {
        const { createWebAgentSessionServices } = await import("@/lib/web-model-runtime");
        await createWebAgentSessionServices({
          cwd: agentDir,
          agentDir,
          modelRuntime: runtime,
          fixedProvidersOnly: true,
        });
      }

      const providers = runtime.getProviders();
      const providerInfo = providers.find((p) => p.id === provider && providerHasOAuth(p));
      if (!providerInfo) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        controller.close();
        return;
      }

      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = () => {
        const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      const interaction: AuthInteraction = {
        signal: abort.signal,
        notify(event: AuthEvent) {
          if (event.type === "auth_url") {
            const request = getManualInputRequest();
            send(controller, {
              type: "auth",
              url: event.url,
              instructions: event.instructions ?? null,
              token: request.token,
            });
            return;
          }
          if (event.type === "device_code") {
            send(controller, {
              type: "device_code",
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              intervalSeconds: event.intervalSeconds ?? null,
              expiresInSeconds: event.expiresInSeconds ?? null,
            });
            return;
          }
          if (event.type === "progress") {
            send(controller, { type: "progress", message: event.message });
            return;
          }
          if (event.type === "info") {
            send(controller, { type: "progress", message: event.message });
          }
        },
        async prompt(prompt: AuthPrompt): Promise<string> {
          if (prompt.type === "select") {
            const request = createClientInputRequest();
            send(controller, {
              type: "select_request",
              message: prompt.message,
              options: prompt.options,
              token: request.token,
            });
            const value = await request.promise;
            return value || "";
          }

          // text / secret / manual_code share the existing token + POST backfill path.
          const request = getManualInputRequest();
          send(controller, {
            type: "prompt_request",
            message: prompt.message,
            placeholder: "placeholder" in prompt ? (prompt.placeholder ?? null) : null,
            token: request.token,
          });
          return request.promise;
        },
      };

      try {
        const credential = await runtime.login(provider, "oauth", interaction);

        if (addAccountMode) {
          const account = await saveOAuthAccountCredential(provider, credential as Credential);
          send(controller, { type: "success", account, message: "Account saved successfully." });
        } else {
          if (isSupportedOAuthAccountProvider(provider)) {
            await syncActiveOAuthAccountCredential(provider).catch(() => {});
          }
          await Promise.resolve(reloadRpcAuthState());
          send(controller, { type: "success" });
        }
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg === "Login cancelled") {
          send(controller, { type: "cancelled" });
        } else if (provider === ANTIGRAVITY_PROVIDER_ID) {
          // Upstream token exchange may embed response text; never project it.
          send(controller, { type: "error", message: sanitizeAntigravityLoginError(err) });
        } else {
          send(controller, { type: "error", message: rawMsg });
        }
      } finally {
        cleanup();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
