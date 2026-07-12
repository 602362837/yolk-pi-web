import assert from "node:assert/strict";
import { resolveYpiStudioMemberPolicy } from "../lib/ypi-studio-policy.ts";
import { DEFAULT_PI_WEB_CONFIG, PI_WEB_STUDIO_DEFAULT_MEMBERS, validatePiWebStudioConfig } from "../lib/pi-web-config.ts";

const policy = (model, thinking = "inherit") => ({ model, thinking });
const configResult = (studio, extra = {}) => ({
  config: {
    yolk: { defaultToolPreset: "default", defaultThinkingLevel: "auto" },
    worktree: { baseRef: "HEAD", branchNameTemplate: "", baseDirTemplate: "", pathTemplate: "", sessionDisplay: "separate" },
    trellis: {},
    studio,
    usage: { includeArchived: true },
    terminal: {},
    chatgpt: {},
    editor: {},
  },
  defaults: {},
  path: "/tmp/pi-web.json",
  exists: true,
  ...extra,
});

const baseStudio = {
  defaultPolicy: policy({ mode: "followMain" }, "inherit"),
  members: {
    architect: policy({ mode: "specific", provider: "anthropic", modelId: "claude" }, "high"),
    implementer: policy({ mode: "unset" }, "inherit"),
    checker: policy({ mode: "piDefault" }, "low"),
  },
};

{
  const resolved = resolveYpiStudioMemberPolicy({
    input: { member: "Architect", model: "openai/gpt-5", thinking: "medium" },
    configResult: configResult(baseStudio),
    main: { model: { provider: "main", id: "model" }, thinking: "low" },
  });
  assert.equal(resolved.member, "architect");
  assert.equal(resolved.modelArg, "openai/gpt-5");
  assert.equal(resolved.modelSource, "toolInput");
  assert.equal(resolved.thinkingArg, "medium");
  assert.equal(resolved.thinkingSource, "toolInput");
  assert.ok(resolved.diagnostics.warnings?.some((warning) => warning.code === "member_id_normalized"));
  assert.ok(resolved.diagnostics.warnings?.some((warning) => warning.code === "tool_model_overrides_settings"));
}

{
  const resolved = resolveYpiStudioMemberPolicy({
    input: { member: "checker" },
    configResult: configResult(baseStudio),
    main: { model: { provider: "main", id: "model" }, thinking: "xhigh" },
  });
  assert.equal(resolved.modelLabel, "Pi default");
  assert.equal(resolved.modelSource, "piDefault");
  assert.equal(resolved.thinkingArg, "low");
  assert.equal(resolved.thinkingSource, "memberConfig");
}

{
  const resolved = resolveYpiStudioMemberPolicy({
    input: { member: "implementer" },
    configResult: configResult({
      ...baseStudio,
      defaultPolicy: policy({ mode: "specific", provider: "google", modelId: "gemini" }, "minimal"),
    }),
    main: {},
  });
  assert.equal(resolved.modelArg, "google/gemini");
  assert.equal(resolved.modelSource, "defaultPolicy");
  assert.ok(resolved.diagnostics.warnings?.some((warning) => warning.code === "member_policy_unset"));
}

{
  const resolved = resolveYpiStudioMemberPolicy({
    input: { member: "custom", model: "bad model", thinking: "auto" },
    configResult: configResult({ defaultPolicy: policy({ mode: "followMain" }, "inherit"), members: {} }, { parseError: "boom" }),
    main: {},
  });
  assert.equal(resolved.modelLabel, "Pi default");
  assert.equal(resolved.modelSource, "piDefault");
  assert.equal(resolved.thinkingSource, "piDefault");
  const codes = resolved.diagnostics.warnings?.map((warning) => warning.code) ?? [];
  assert.ok(codes.includes("config_parse_error"));
  assert.ok(codes.includes("tool_model_invalid"));
  assert.ok(codes.includes("tool_thinking_invalid"));
  assert.ok(codes.includes("follow_main_model_unavailable"));
  assert.ok(codes.includes("follow_main_thinking_unavailable"));
}

{
  assert.equal(DEFAULT_PI_WEB_CONFIG.studio.subagents.runner, "auto");
  assert.equal(validatePiWebStudioConfig({ members: {}, subagents: { runner: "sdk" } }).subagents.runner, "sdk");
  assert.equal(validatePiWebStudioConfig({ members: {}, subagents: { runner: "cli" } }).subagents.runner, "cli");
  assert.throws(() => validatePiWebStudioConfig({ members: {}, subagents: { runner: "bad" } }), /studio\.subagents\.runner must be auto, sdk, or cli/);
}

// --- Improver default member and policy chain ---

{
  // improver is a default member, ordered after architect and before ui-designer
  assert.deepEqual([...PI_WEB_STUDIO_DEFAULT_MEMBERS], ["architect", "improver", "ui-designer", "implementer", "checker"]);
  assert.ok(DEFAULT_PI_WEB_CONFIG.studio.members.improver, "default config includes improver member policy");
  assert.equal(DEFAULT_PI_WEB_CONFIG.studio.members.improver.model.mode, "followMain");
  assert.equal(DEFAULT_PI_WEB_CONFIG.studio.members.improver.thinking, "inherit");
}

{
  // improver with no per-member config falls through to defaultPolicy (followMain) -> main model
  const resolved = resolveYpiStudioMemberPolicy({
    input: { member: "improver" },
    configResult: configResult({ ...baseStudio, members: { architect: baseStudio.members.architect } }),
    main: { model: { provider: "anthropic", id: "claude-opus" }, thinking: "high" },
  });
  assert.equal(resolved.member, "improver");
  assert.equal(resolved.modelArg, "anthropic/claude-opus");
  assert.equal(resolved.modelSource, "followMain");
  assert.equal(resolved.thinkingArg, "high");
  assert.equal(resolved.thinkingSource, "followMain");
  // No member-policy normalization/precedence warning expected for a clean improver lookup.
  const codes = resolved.diagnostics.warnings?.map((warning) => warning.code) ?? [];
  assert.ok(!codes.includes("member_id_normalized"), "improver id is already canonical");
}

{
  // improver explicit member config (model + thinking) wins over defaultPolicy
  const resolved = resolveYpiStudioMemberPolicy({
    input: { member: "Improver", thinking: "medium" },
    configResult: configResult({
      ...baseStudio,
      members: { ...baseStudio.members, improver: policy({ mode: "specific", provider: "openai", modelId: "gpt-5" }, "low") },
    }),
    main: { model: { provider: "main", id: "model" }, thinking: "high" },
  });
  assert.equal(resolved.member, "improver");
  assert.equal(resolved.modelArg, "openai/gpt-5");
  assert.equal(resolved.modelSource, "memberConfig");
  assert.equal(resolved.thinkingArg, "medium");
  assert.equal(resolved.thinkingSource, "toolInput");
  assert.ok(resolved.diagnostics.warnings?.some((warning) => warning.code === "member_id_normalized"));
}

{
  // improver tool-input model overrides the member config and is preferred
  const resolved = resolveYpiStudioMemberPolicy({
    input: { member: "improver", model: "google/gemini-2.5-pro", thinking: "xhigh" },
    configResult: configResult({
      ...baseStudio,
      members: { ...baseStudio.members, improver: policy({ mode: "specific", provider: "openai", modelId: "gpt-5" }, "low") },
    }),
    main: {},
  });
  assert.equal(resolved.modelArg, "google/gemini-2.5-pro");
  assert.equal(resolved.modelSource, "toolInput");
  assert.equal(resolved.thinkingArg, "xhigh");
  assert.equal(resolved.thinkingSource, "toolInput");
}

console.log("ypi-studio policy resolver tests passed");
