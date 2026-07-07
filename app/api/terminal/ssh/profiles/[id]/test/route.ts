import { NextResponse } from "next/server";
import { readPiWebConfig } from "@/lib/pi-web-config";
import { createTerminalSshLaunchPlan, detectSshExecutable, TerminalSshRunnerError } from "@/lib/terminal-ssh-runner";
import { readTerminalCredentialSecret, TerminalSshVaultError } from "@/lib/terminal-ssh-vault";
import type { TerminalSshEndpoint, TerminalSshProfile, TerminalSshProxyConfig } from "@/lib/terminal-ssh-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function credentialReferences(profile: TerminalSshProfile): string[] {
  const ids = new Set<string>();
  const addEndpoint = (endpoint: TerminalSshEndpoint) => {
    if (endpoint.credentialId) ids.add(endpoint.credentialId);
  };
  addEndpoint(profile.target);
  profile.jumpHosts.forEach(addEndpoint);
  const proxy: TerminalSshProxyConfig | undefined = profile.proxy;
  if ((proxy?.type === "socks5" || proxy?.type === "http") && proxy.credentialId) ids.add(proxy.credentialId);
  return [...ids];
}

async function missingCredentialIds(profile: TerminalSshProfile): Promise<string[]> {
  const missing: string[] = [];
  for (const id of credentialReferences(profile)) {
    try {
      await readTerminalCredentialSecret(id);
    } catch (error) {
      if (error instanceof TerminalSshVaultError && error.status === 404) missing.push(id);
      else throw error;
    }
  }
  return missing;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof TerminalSshRunnerError || error instanceof TerminalSshVaultError ? error.status : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as unknown;
    const mode = isRecord(body) && body.mode === "resolve" ? "resolve" : "validate";
    const config = readPiWebConfig().terminal.ssh;
    const profile = config.profiles.find((candidate) => candidate.id === decodeURIComponent(id));
    if (!profile) return NextResponse.json({ ok: false, error: "SSH profile not found" }, { status: 404 });

    const missingCredentials = await missingCredentialIds(profile);
    const warnings: string[] = [];
    if (!config.enabled) warnings.push("Terminal SSH is disabled; sessions cannot start until it is enabled.");
    if (profile.proxy?.type === "custom") {
      if (!config.allowCustomProxyCommand) warnings.push("Custom ProxyCommand is disabled globally.");
      if (!profile.proxy.acknowledgedRisk) warnings.push("Custom ProxyCommand risk is not acknowledged on this profile.");
    }
    if (profile.options?.knownHostsPolicy === "accept-new" || (!profile.options?.knownHostsPolicy && config.defaultKnownHostsPolicy === "accept-new")) {
      warnings.push("accept-new trusts the first observed host key; verify fingerprints to reduce MITM risk.");
    }

    let sshExecutable: string | null = null;
    try {
      sshExecutable = await detectSshExecutable(process.env);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }

    if (mode === "validate") {
      return NextResponse.json({ ok: missingCredentials.length === 0, mode, profileId: profile.id, missingCredentials, warnings, sshExecutable });
    }

    const plan = await createTerminalSshLaunchPlan({ profile, sshConfig: config, baseEnv: process.env, terminalEnv: {} });
    await plan.cleanup();
    return NextResponse.json({ ok: missingCredentials.length === 0, mode, profileId: profile.id, missingCredentials, warnings, sshExecutable, plan: plan.redacted });
  } catch (error) {
    return errorResponse(error);
  }
}
