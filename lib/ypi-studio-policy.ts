import type { PiWebConfigReadResult, PiWebSubagentRunPolicy, PiWebSubagentThinking } from "./pi-web-config";
import type {
  YpiStudioPolicyResolution,
  YpiStudioPolicySource,
  YpiStudioPolicyWarning,
  YpiStudioPolicyWarningCode,
  YpiStudioSubagentPolicyDiagnostics,
} from "./ypi-studio-types";

export type YpiStudioThinkingArg = Exclude<PiWebSubagentThinking, "inherit">;

export interface YpiStudioPolicyInput {
  member?: string;
  model?: string;
  thinking?: string;
}

export interface YpiStudioMainSessionPolicyContext {
  model?: { provider?: string; id?: string };
  thinking?: string;
}

export interface ResolvedYpiStudioMemberPolicy {
  member: string;
  modelArg?: string;
  modelLabel: string;
  modelSource: YpiStudioPolicySource;
  thinkingArg?: YpiStudioThinkingArg;
  thinkingLabel: string;
  thinkingSource: YpiStudioPolicySource;
  diagnostics: YpiStudioSubagentPolicyDiagnostics;
  warnings: string[];
}

const VALID_THINKING = new Set<YpiStudioThinkingArg>(["off", "minimal", "low", "medium", "high", "xhigh"]);

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function warning(code: YpiStudioPolicyWarningCode, message: string): YpiStudioPolicyWarning {
  return { code, message };
}

export function canonicalizeYpiStudioMemberId(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isThinkingArg(value: string | undefined): value is YpiStudioThinkingArg {
  return !!value && VALID_THINKING.has(value as YpiStudioThinkingArg);
}

function isModelArg(value: string | undefined): value is string {
  return !!value && /^[^/\s]+\/.+\S$/.test(value) && !/\s/.test(value);
}

function mainModelArg(ctx: YpiStudioMainSessionPolicyContext): string | undefined {
  const provider = clean(ctx.model?.provider);
  const id = clean(ctx.model?.id);
  return provider && id ? `${provider}/${id}` : undefined;
}

function collectWarnings(...items: Array<YpiStudioPolicyWarning[] | undefined>): YpiStudioPolicyWarning[] | undefined {
  const warnings = items.flatMap((item) => item ?? []);
  return warnings.length ? warnings : undefined;
}

function resolveConfiguredModel(
  policy: PiWebSubagentRunPolicy,
  configuredSource: "memberConfig" | "defaultPolicy",
  ctx: YpiStudioMainSessionPolicyContext,
  initialChain: YpiStudioPolicySource[],
): YpiStudioPolicyResolution {
  const chain = [...initialChain];
  const warnings: YpiStudioPolicyWarning[] = [];
  const mode = policy.model.mode;
  if (mode === "specific") {
    const provider = clean(policy.model.provider);
    const modelId = clean(policy.model.modelId);
    if (provider && modelId) {
      const model = `${provider}/${modelId}`;
      return { label: model, arg: model, effectiveSource: configuredSource, configuredSource, configuredMode: mode, fallbackChain: chain, warnings: collectWarnings(warnings) };
    }
  }
  if (mode === "followMain") {
    chain.push("followMain");
    const model = mainModelArg(ctx);
    if (model) return { label: model, arg: model, effectiveSource: "followMain", configuredSource, configuredMode: mode, fallbackChain: chain, warnings: collectWarnings(warnings) };
    chain.push("piDefault");
    warnings.push(warning("follow_main_model_unavailable", "Studio policy follows the main model, but the main session model was unavailable; falling back to Pi default."));
    return { label: "Pi default", effectiveSource: "piDefault", configuredSource, configuredMode: mode, fallbackChain: chain, warnings: collectWarnings(warnings) };
  }
  if (mode === "piDefault") {
    chain.push("piDefault");
    return { label: "Pi default", effectiveSource: "piDefault", configuredSource, configuredMode: mode, fallbackChain: chain, warnings: collectWarnings(warnings) };
  }
  return { label: "unset", effectiveSource: "unset", configuredSource, configuredMode: mode, fallbackChain: chain, warnings: collectWarnings(warnings) };
}

function resolveModel(
  input: YpiStudioPolicyInput,
  memberPolicy: PiWebSubagentRunPolicy | undefined,
  defaultPolicy: PiWebSubagentRunPolicy,
  ctx: YpiStudioMainSessionPolicyContext,
): YpiStudioPolicyResolution {
  const requested = clean(input.model);
  if (requested) {
    if (isModelArg(requested)) {
      return {
        label: requested,
        arg: requested,
        effectiveSource: "toolInput",
        configuredSource: "toolInput",
        configuredMode: "model",
        requested,
        fallbackChain: ["toolInput"],
        warnings: [warning("tool_model_overrides_settings", "Tool input model overrides Studio Settings for this member run.")],
      };
    }
  }

  const preWarnings: YpiStudioPolicyWarning[] = [];
  if (requested) preWarnings.push(warning("tool_model_invalid", `Tool input model '${requested}' is invalid; expected provider/modelId, so Studio Settings fallback was used.`));

  if (memberPolicy) {
    const memberResolution = resolveConfiguredModel(memberPolicy, "memberConfig", ctx, ["memberConfig"]);
    if (memberResolution.effectiveSource !== "unset") {
      memberResolution.warnings = collectWarnings(preWarnings, memberResolution.warnings);
      return memberResolution;
    }
    preWarnings.push(warning("member_policy_unset", "Member model policy is unset; falling back to Studio default policy."));
  }

  const defaultResolution = resolveConfiguredModel(defaultPolicy, "defaultPolicy", ctx, [...(memberPolicy ? ["memberConfig", "unset"] as YpiStudioPolicySource[] : []), "defaultPolicy"]);
  if (defaultResolution.effectiveSource !== "unset") {
    defaultResolution.warnings = collectWarnings(preWarnings, defaultResolution.warnings);
    return defaultResolution;
  }

  preWarnings.push(warning("default_policy_unset", "Studio default model policy is unset; falling back through followMain to Pi default."));
  const fallbackResolution = resolveConfiguredModel({ ...defaultPolicy, model: { mode: "followMain" } }, "defaultPolicy", ctx, [...defaultResolution.fallbackChain, "unset"]);
  fallbackResolution.warnings = collectWarnings(preWarnings, fallbackResolution.warnings);
  return fallbackResolution;
}

function resolveConfiguredThinking(
  policy: PiWebSubagentRunPolicy,
  configuredSource: "memberConfig" | "defaultPolicy",
  ctx: YpiStudioMainSessionPolicyContext,
): YpiStudioPolicyResolution {
  if (policy.thinking === "inherit") {
    const chain: YpiStudioPolicySource[] = [configuredSource, "followMain"];
    const inherited = clean(ctx.thinking);
    if (isThinkingArg(inherited)) {
      return { label: inherited, arg: inherited, effectiveSource: "followMain", configuredSource, configuredMode: "inherit", fallbackChain: chain };
    }
    chain.push("piDefault");
    return {
      label: "default",
      effectiveSource: "piDefault",
      configuredSource,
      configuredMode: "inherit",
      fallbackChain: chain,
      warnings: [warning("follow_main_thinking_unavailable", "Studio policy inherits thinking, but the main session thinking level was unavailable; falling back to Pi default.")],
    };
  }
  return {
    label: policy.thinking,
    arg: policy.thinking,
    effectiveSource: configuredSource,
    configuredSource,
    configuredMode: policy.thinking,
    fallbackChain: [configuredSource],
  };
}

function resolveThinking(
  input: YpiStudioPolicyInput,
  memberPolicy: PiWebSubagentRunPolicy | undefined,
  defaultPolicy: PiWebSubagentRunPolicy,
  ctx: YpiStudioMainSessionPolicyContext,
): YpiStudioPolicyResolution {
  const requested = clean(input.thinking);
  if (requested) {
    if (isThinkingArg(requested)) {
      return {
        label: requested,
        arg: requested,
        effectiveSource: "toolInput",
        configuredSource: "toolInput",
        configuredMode: "thinking",
        requested,
        fallbackChain: ["toolInput"],
        warnings: [warning("tool_thinking_overrides_settings", "Tool input thinking overrides Studio Settings for this member run.")],
      };
    }
  }
  const preWarnings = requested
    ? [warning("tool_thinking_invalid", `Tool input thinking '${requested}' is invalid; Studio Settings fallback was used.`)]
    : [];
  const source = memberPolicy ? "memberConfig" : "defaultPolicy";
  const resolved = resolveConfiguredThinking(memberPolicy ?? defaultPolicy, source, ctx);
  resolved.warnings = collectWarnings(preWarnings, resolved.warnings);
  return resolved;
}

export function resolveYpiStudioMemberPolicy(options: {
  input: YpiStudioPolicyInput;
  configResult: PiWebConfigReadResult;
  main: YpiStudioMainSessionPolicyContext;
}): ResolvedYpiStudioMemberPolicy {
  const memberInput = clean(options.input.member) ?? "";
  const member = canonicalizeYpiStudioMemberId(memberInput);
  const studio = options.configResult.config.studio;
  const memberPolicyFound = Object.prototype.hasOwnProperty.call(studio.members, member);
  const memberPolicy = memberPolicyFound ? studio.members[member] : undefined;
  const topWarnings: YpiStudioPolicyWarning[] = [];
  if (memberInput && memberInput !== member) {
    topWarnings.push(warning("member_id_normalized", `Studio member id '${memberInput}' was normalized to '${member}'.`));
  }
  if (options.configResult.parseError) {
    topWarnings.push(warning("config_parse_error", `Could not parse pi-web.json; Studio default configuration was used. ${options.configResult.parseError}`));
  }

  const model = resolveModel(options.input, memberPolicy, studio.defaultPolicy, options.main);
  const thinking = resolveThinking(options.input, memberPolicy, studio.defaultPolicy, options.main);
  const warnings = collectWarnings(topWarnings, model.warnings, thinking.warnings);
  const diagnostics: YpiStudioSubagentPolicyDiagnostics = {
    schemaVersion: 1,
    memberInput,
    member,
    memberPolicyFound,
    config: {
      exists: options.configResult.exists,
      parseError: options.configResult.parseError,
      pathLabel: "~/.pi/agent/pi-web.json",
    },
    model,
    thinking,
    warnings,
  };

  return {
    member,
    modelArg: model.arg,
    modelLabel: model.label,
    modelSource: model.effectiveSource,
    thinkingArg: isThinkingArg(thinking.arg) ? thinking.arg : undefined,
    thinkingLabel: thinking.label,
    thinkingSource: thinking.effectiveSource,
    diagnostics,
    warnings: (warnings ?? []).map((item) => `${item.code}: ${item.message}`),
  };
}
