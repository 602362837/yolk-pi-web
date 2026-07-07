#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function assertIncludes(source, needle, label) {
  assert.ok(source.includes(needle), `${label} should include ${needle}`);
}

function assertNotIncludes(source, needle, label) {
  assert.ok(!source.includes(needle), `${label} should not include ${needle}`);
}

function assertMatches(source, pattern, label) {
  assert.ok(pattern.test(source), `${label} should match ${pattern}`);
}

const piWebConfig = read("lib/pi-web-config.ts");
const vault = read("lib/terminal-ssh-vault.ts");
const knownHosts = read("lib/terminal-known-hosts.ts");
const runner = read("lib/terminal-ssh-runner.ts");
const manager = read("lib/terminal-manager.ts");
const credentialRoute = read("app/api/terminal/ssh/credentials/route.ts");
const credentialIdRoute = read("app/api/terminal/ssh/credentials/[id]/route.ts");
const profileStore = read("lib/terminal-ssh-profiles.ts");
const profileRoute = read("app/api/terminal/ssh/profiles/route.ts");
const profileIdRoute = read("app/api/terminal/ssh/profiles/[id]/route.ts");
const profileTestRoute = read("app/api/terminal/ssh/profiles/[id]/test/route.ts");
const profilePicker = read("components/TerminalSshProfilePicker.tsx");
const terminalPanel = read("components/TerminalPanel.tsx");

// terminal.ssh config defaults and validation boundary.
assertIncludes(piWebConfig, "ssh: {", "pi-web default terminal ssh config");
assertIncludes(piWebConfig, "enabled: false", "terminal ssh default disabled");
assertIncludes(piWebConfig, "allowCustomProxyCommand: false", "custom ProxyCommand default disabled");
assertIncludes(piWebConfig, "defaultKnownHostsPolicy: \"ask\"", "known_hosts default policy");
assertIncludes(piWebConfig, "applyTerminalEnvToSsh: false", "terminal env not applied to SSH by default");
assertIncludes(piWebConfig, "TERMINAL_SSH_FORBIDDEN_SECRET_FIELDS", "profile secret field rejection");
for (const secret of ["privateKeyPem", "password", "passphrase", "proxyPassword"]) {
  assertIncludes(piWebConfig, secret, `pi-web validation rejects ${secret}`);
}
assertIncludes(piWebConfig, "must not reference secret placeholders", "custom ProxyCommand secret placeholder rejection");
assertIncludes(piWebConfig, "must not contain control characters", "custom ProxyCommand control-char rejection");

// Credential summary redaction and vault isolation.
assertIncludes(vault, "const VAULT_DIR_NAME = \"terminal-secrets\"", "credential vault directory");
assertIncludes(vault, "const VAULT_DIR_MODE = 0o700", "credential vault directory mode");
assertIncludes(vault, "const CREDENTIALS_FILE_MODE = 0o600", "credential file mode");
const toSummaryBody = vault.slice(vault.indexOf("function toSummary"), vault.indexOf("function requireCredentialType"));
for (const secretField of ["privateKeyPem", "password", "passphrase", "proxyPassword"]) {
  if (secretField === "password") assertIncludes(toSummaryBody, "hasPassword", "credential summary exposes password presence only");
  assertNotIncludes(toSummaryBody, `${secretField}:`, `credential summary must not return ${secretField}`);
}
assertIncludes(credentialRoute, "listTerminalCredentials", "credential list API uses summaries");
assertIncludes(credentialIdRoute, "getTerminalCredentialSummary", "credential get API uses summary");
assertIncludes(credentialIdRoute, "references", "credential delete reports profile references");

// known_hosts dedicated storage and HostKeyAlias helpers.
assertIncludes(knownHosts, "join(getAgentDir(), \"terminal\")", "known_hosts directory is dedicated");
assertIncludes(knownHosts, "known_hosts", "known_hosts file name");
assertIncludes(knownHosts, "return `${normalizeKnownHostHost(host)}:${normalizeKnownHostPort(port)}`", "stable host:port HostKeyAlias");
assertIncludes(knownHosts, "ssh-keyscan can display a host key fingerprint", "scan warning documents trust boundary");

// OpenSSH launch plan: config generation, redaction, proxy secret boundary, cleanup.
for (const option of ["HostKeyAlias", "UserKnownHostsFile", "StrictHostKeyChecking", "ProxyJump", "ProxyCommand", "IdentityFile", "ForwardAgent"]) {
  assertIncludes(runner, option, `ssh_config generation includes ${option}`);
}
assertIncludes(runner, "args: [\"-F\", \"<session-ssh-config>\", target.alias]", "redacted args hide temp ssh_config path");
assertIncludes(runner, "redacted: { type: proxy.type, host: proxy.host, port: proxy.port, hasAuth", "proxy redaction exposes auth presence only");
assertIncludes(runner, "proxy-context.json", "proxy auth stored in temp context file");
assertIncludes(runner, "${sshConfigValue(process.execPath)} ${sshConfigValue(helper)} ${sshConfigValue(contextPath)} %h %p", "proxy command does not inline proxy secret");
assertIncludes(runner, "SSH_ASKPASS_REQUIRE", "askpass force is configured when possible");
assertIncludes(runner, "refusing to cleanup non-terminal SSH temp directory", "temp cleanup prefix guard");
assertIncludes(runner, "startsWith(TEMP_PREFIX)", "startup sweep is prefix-limited");

// Terminal/session and UI compatibility: local default remains, SSH gated, no secret in tab/picker state.
assertIncludes(manager, "rawKind === \"ssh\" ? \"ssh\" : \"local\"", "terminal sessions default to local kind");
assertIncludes(manager, "Web terminal SSH is disabled", "SSH session gate respects terminal.ssh.enabled");
assertIncludes(manager, "validateEnv(config.env)", "terminal env remains validated");
assertIncludes(profilePicker, "Custom ProxyCommand is disabled globally", "picker blocks globally disabled custom ProxyCommand");
assertIncludes(profilePicker, "Custom ProxyCommand risk has not been acknowledged", "picker blocks unacknowledged custom ProxyCommand");
assertMatches(terminalPanel, /profileId|profileLabel|targetLabel/, "terminal tab stores SSH profile labels");
for (const forbiddenUiField of ["privateKeyPem", "proxyPassword"]) {
  assertNotIncludes(profilePicker, forbiddenUiField, `profile picker must not render ${forbiddenUiField}`);
  assertNotIncludes(terminalPanel, forbiddenUiField, `terminal panel must not render ${forbiddenUiField}`);
}

// Profile CRUD/preflight routes must reject secrets and return only non-secret/redacted data.
assertIncludes(profileStore, "FORBIDDEN_SECRET_FIELDS", "profile CRUD helper has route-level secret field rejection");
for (const secret of ["privateKeyPem", "password", "passphrase", "proxyPassword"]) {
  assertIncludes(profileStore, secret, `profile CRUD rejects ${secret}`);
}
assertIncludes(profileRoute, "createTerminalSshProfile", "profile collection route creates through validated helper");
assertIncludes(profileIdRoute, "updateTerminalSshProfile", "profile id route updates through validated helper");
assertIncludes(profileIdRoute, "deleteTerminalSshProfile", "profile id route deletes through profile helper");
assertIncludes(profileTestRoute, "plan.redacted", "profile resolve API returns redacted launch plan");
assertNotIncludes(profileTestRoute, "privateKeyPem", "profile test route must not reference private key material");
assertNotIncludes(profileTestRoute, "proxyPassword", "profile test route must not reference proxy password");

// Dry-run temp cleanup check for the expected temp prefix behavior.
const tempDir = await mkdtemp(join(tmpdir(), "ypi-terminal-ssh-test-"));
const secretPath = join(tempDir, "context.json");
await writeFile(secretPath, JSON.stringify({ password: "sample-secret" }), { mode: 0o600 });
if (process.platform !== "win32") {
  assert.equal(statSync(secretPath).mode & 0o777, 0o600, "secret dry-run file should be 0600");
}
await rm(tempDir, { recursive: true, force: true });
assert.equal(existsSync(tempDir), false, "temp dry-run directory should be removed");

console.log("terminal SSH config/security dry-run checks passed");
