export type TerminalSshKnownHostsPolicy = "ask" | "strict" | "accept-new";

export interface PiWebTerminalSshConfig {
  enabled: boolean;
  allowCustomProxyCommand: boolean;
  defaultKnownHostsPolicy: TerminalSshKnownHostsPolicy;
  applyTerminalEnvToSsh: boolean;
  profiles: TerminalSshProfile[];
}

export interface TerminalSshProfile {
  id: string;
  label: string;
  enabled: boolean;
  target: TerminalSshEndpoint;
  jumpHosts: TerminalSshEndpoint[];
  proxy?: TerminalSshProxyConfig;
  options?: TerminalSshProfileOptions;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalSshEndpoint {
  id?: string;
  label?: string;
  host: string;
  port: number;
  username?: string;
  credentialId?: string;
}

export interface TerminalSshProfileOptions {
  connectTimeoutSeconds?: number;
  serverAliveIntervalSeconds?: number;
  forwardAgent?: boolean;
  knownHostsPolicy?: TerminalSshKnownHostsPolicy;
  requestTty?: boolean;
}

export type TerminalSshProxyConfig =
  | { type: "none" }
  | { type: "socks5"; host: string; port: number; credentialId?: string }
  | { type: "http"; host: string; port: number; credentialId?: string }
  | { type: "custom"; commandTemplate: string; acknowledgedRisk: boolean };

export type TerminalCredentialType = "agent" | "identityFile" | "privateKey" | "password" | "proxyAuth";

export interface TerminalCredentialSummary {
  id: string;
  label: string;
  type: TerminalCredentialType;
  username?: string;
  proxyUsername?: string;
  identityFilePath?: string;
  hasPrivateKey: boolean;
  hasPassword: boolean;
  hasPassphrase: boolean;
  hasProxyPassword: boolean;
  fingerprint?: string;
  usedByProfileIds: string[];
  createdAt: string;
  updatedAt: string;
}
