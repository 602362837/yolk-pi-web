import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveYpiStudioMemberPolicy } from "../lib/ypi-studio-policy.ts";
import { DEFAULT_PI_WEB_CONFIG, PI_WEB_STUDIO_DEFAULT_MEMBERS, validatePiWebStudioConfig } from "../lib/pi-web-config.ts";
import {
  buildYpiStudioUnattendedScopeFingerprint,
  createYpiStudioGithubUnattendedTask,
  createYpiStudioTask,
  evaluateYpiStudioUnattendedCompletionEvidence,
  evaluateYpiStudioUnattendedImplementationAuthorization,
  getYpiStudioTaskDetail,
  getYpiStudioTaskExecutionMode,
  hashYpiStudioImplementationPlan,
  recordYpiStudioOwnerAuthorization,
  recordYpiStudioPolicyGrant,
  recordYpiStudioUnattendedCompletionEvidence,
  recordYpiStudioUserApproval,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
  updateYpiStudioTaskArtifact,
} from "../lib/ypi-studio-tasks.ts";

const policy = (model, thinking = "inherit") => ({ model, thinking });
const configResult = (studio, extra = {}) => ({
  config: {
    yolk: { defaultToolPreset: "default", defaultModel: { mode: "piDefault" }, defaultThinkingLevel: "auto" },
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

// --- GitHub unattended policy authorization (GHA-05) ---

function writePlanReview(cwd, taskId, contextId) {
  updateYpiStudioTaskArtifact(taskId, {
    cwd,
    action: "update_artifact",
    artifact: "plan-review",
    content: "# 计划审批书\n\n## 审批请求\n自动化/测试审批材料。\n\n## 必读产物\n- [Implement](./implement.md)\n",
    contextId,
  });
}

function futureIso(ms = 60 * 60 * 1000) {
  return new Date(Date.now() + ms).toISOString();
}

function pastIso(ms = 60 * 1000) {
  return new Date(Date.now() - ms).toISOString();
}

function seedUnattendedPlan(cwd, taskId, contextId) {
  return updateYpiStudioImplementationPlan(taskId, {
    cwd,
    action: "update_implementation_plan",
    contextId,
    implementationPlan: {
      schemaVersion: 2,
      summary: "docs fix",
      subtasks: [
        { id: "DOC-01", title: "Update docs", dependsOn: [], relation: "serial" },
      ],
    },
  });
}

function authorizeUnattended(cwd, task, opts = {}) {
  const uiGate = opts.uiGate ?? "pass";
  const expiresAt = opts.expiresAt ?? futureIso();
  recordYpiStudioOwnerAuthorization({
    cwd,
    taskId: task.id,
    repositoryId: task.meta.automationBinding.repositoryId,
    issueNumber: task.meta.automationBinding.issueNumber,
    ownerActorId: 42,
    ownerCommentId: 1001,
    ownerCommentHash: "comment-hash-abc",
    claimStatus: "complete",
    recommendation: "yes",
    matchedPhrase: "可以做",
  });
  return recordYpiStudioPolicyGrant({
    cwd,
    taskId: task.id,
    policyId: "docs-and-small-bugfix",
    policyVersion: "1",
    policyHash: "policy-hash-1",
    uiGate,
    expiresAt,
    riskProfile: "docs-and-small-bugfix",
    executionProfile: "full-agent",
  });
}

{
  // Historical / default tasks remain interactive
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-exec-mode-"));
  try {
    const task = createYpiStudioTask({ cwd, title: "Interactive default", workflowId: "feature-dev", contextId: "pi_interactive" });
    assert.equal(getYpiStudioTaskExecutionMode(task), "interactive");
    assert.equal(task.meta.executionMode, undefined);
    assert.equal(task.meta.policyGrant, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Unattended create sets mode + binding; public interactive create never gets policyGrant
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-unattended-create-"));
  try {
    const scope = buildYpiStudioUnattendedScopeFingerprint({ repositoryId: 602362837, issueNumber: 12 });
    const task = createYpiStudioGithubUnattendedTask({
      cwd,
      title: "Unattended issue 12",
      workflowId: "feature-dev",
      contextId: "pi_unattended_create",
      repositoryId: 602362837,
      issueNumber: 12,
      scopeFingerprint: scope,
      jobId: "job-12",
    });
    assert.equal(task.meta.executionMode, "github_unattended");
    assert.equal(task.meta.automationBinding.repositoryId, 602362837);
    assert.equal(task.meta.automationBinding.issueNumber, 12);
    assert.equal(task.meta.automationBinding.scopeFingerprint, scope);
    assert.equal(task.meta.approvalGrant, undefined);
    assert.equal(task.meta.policyGrant, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Interactive grant cannot authorize unattended; policyGrant cannot authorize interactive
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-grant-isolation-"));
  try {
    const contextId = "pi_grant_isolation";
    const interactive = createYpiStudioTask({ cwd, title: "Interactive isolation", workflowId: "feature-dev", contextId });
    transitionYpiStudioTask(interactive.id, { cwd, to: "planning", override: true, contextId });
    writePlanReview(cwd, interactive.id, contextId);
    transitionYpiStudioTask(interactive.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "确认，开始实现");
    // Clean interactive path still works.
    assert.equal(
      transitionYpiStudioTask(interactive.id, { cwd, to: "implementing", override: true, contextId }).status,
      "implementing",
    );

    const scope = buildYpiStudioUnattendedScopeFingerprint({ repositoryId: 9, issueNumber: 3 });
    const unattended = createYpiStudioGithubUnattendedTask({
      cwd,
      title: "Unattended isolation",
      workflowId: "feature-dev",
      contextId: "pi_unattended_isolation",
      repositoryId: 9,
      issueNumber: 3,
      scopeFingerprint: scope,
    });
    transitionYpiStudioTask(unattended.id, { cwd, to: "planning", override: true, contextId: "pi_unattended_isolation" });
    writePlanReview(cwd, unattended.id, "pi_unattended_isolation");
    seedUnattendedPlan(cwd, unattended.id, "pi_unattended_isolation");
    transitionYpiStudioTask(unattended.id, { cwd, to: "awaiting_approval", override: true, contextId: "pi_unattended_isolation" });
    // Chat approval must not mint interactive grant on unattended tasks.
    assert.equal(recordYpiStudioUserApproval(cwd, "pi_unattended_isolation", "确认，开始实现"), null);
    assert.equal(getYpiStudioTaskDetail(cwd, unattended.id)?.meta.approvalGrant, undefined);
    assert.throws(
      () => transitionYpiStudioTask(unattended.id, { cwd, to: "implementing", override: true, contextId: "pi_unattended_isolation" }),
      /policyGrant|owner_authorization|missing_or_incomplete|override cannot bypass/i,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Complete claim + owner + policyGrant authorizes; incomplete claim / UI / expiry / stale plan rejected
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-unattended-auth-"));
  try {
    const contextId = "pi_unattended_auth";
    const scope = buildYpiStudioUnattendedScopeFingerprint({ repositoryId: 77, issueNumber: 5 });
    let task = createYpiStudioGithubUnattendedTask({
      cwd,
      title: "Unattended auth matrix",
      workflowId: "feature-dev",
      contextId,
      repositoryId: 77,
      issueNumber: 5,
      scopeFingerprint: scope,
    });
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    writePlanReview(cwd, task.id, contextId);
    task = seedUnattendedPlan(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });

    assert.equal(evaluateYpiStudioUnattendedImplementationAuthorization(getYpiStudioTaskDetail(cwd, task.id)).authorized, false);

    // Incomplete claim cannot be written as ownerAuthorization
    assert.throws(
      () => recordYpiStudioOwnerAuthorization({
        cwd,
        taskId: task.id,
        repositoryId: 77,
        issueNumber: 5,
        ownerActorId: 1,
        ownerCommentId: 2,
        ownerCommentHash: "h",
        claimStatus: "incomplete",
        recommendation: "yes",
      }),
      /complete claim/i,
    );

    // Owner without policy is not enough
    recordYpiStudioOwnerAuthorization({
      cwd,
      taskId: task.id,
      repositoryId: 77,
      issueNumber: 5,
      ownerActorId: 1,
      ownerCommentId: 2,
      ownerCommentHash: "h",
      claimStatus: "complete",
      recommendation: "yes",
    });
    assert.equal(evaluateYpiStudioUnattendedImplementationAuthorization(getYpiStudioTaskDetail(cwd, task.id)).reasonCode, "missing_policy_grant");

    // UI fail-closed grant is stored but cannot authorize implementing
    const uiBlocked = authorizeUnattended(cwd, getYpiStudioTaskDetail(cwd, task.id), { uiGate: "blocked_manual_ui_approval" });
    assert.equal(uiBlocked.meta.policyGrant.uiGate, "blocked_manual_ui_approval");
    assert.equal(evaluateYpiStudioUnattendedImplementationAuthorization(uiBlocked).reasonCode, "blocked_manual_ui_approval");
    assert.throws(
      () => transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId }),
      /blocked_manual_ui_approval/,
    );

    // Expired grant rejected
    assert.throws(
      () => recordYpiStudioPolicyGrant({
        cwd,
        taskId: task.id,
        policyId: "docs-and-small-bugfix",
        policyVersion: "1",
        policyHash: "policy-hash-1",
        uiGate: "pass",
        expiresAt: pastIso(),
      }),
      /future ISO/i,
    );

    // Valid grant authorizes implementing
    task = authorizeUnattended(cwd, getYpiStudioTaskDetail(cwd, task.id), { uiGate: "pass" });
    const evalOk = evaluateYpiStudioUnattendedImplementationAuthorization(task);
    assert.equal(evalOk.authorized, true, evalOk.message);
    assert.equal(
      transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId }).status,
      "implementing",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Plan/artifact change invalidates policyGrant; completion evidence required and bound
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-unattended-stale-"));
  try {
    const contextId = "pi_unattended_stale";
    const scope = buildYpiStudioUnattendedScopeFingerprint({ repositoryId: 88, issueNumber: 6 });
    let task = createYpiStudioGithubUnattendedTask({
      cwd,
      title: "Unattended stale",
      workflowId: "feature-dev",
      contextId,
      repositoryId: 88,
      issueNumber: 6,
      scopeFingerprint: scope,
    });
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    writePlanReview(cwd, task.id, contextId);
    task = seedUnattendedPlan(cwd, task.id, contextId);
    const planHashBefore = hashYpiStudioImplementationPlan(task.implementationPlan);
    assert.ok(planHashBefore);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    task = authorizeUnattended(cwd, getYpiStudioTaskDetail(cwd, task.id));
    assert.ok(task.meta.policyGrant);

    // Artifact update while awaiting_approval bumps revision and clears policyGrant
    task = updateYpiStudioTaskArtifact(task.id, {
      cwd,
      action: "update_artifact",
      artifact: "implement",
      content: "# Implement\n\nChanged plan scope.\n",
      contextId,
    });
    assert.equal(task.meta.policyGrant, undefined);
    assert.ok((task.meta.planRevision ?? 1) >= 2);
    assert.equal(evaluateYpiStudioUnattendedImplementationAuthorization(task).authorized, false);

    // Re-authorize, then plan update invalidates again
    task = authorizeUnattended(cwd, task);
    task = updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        summary: "docs fix v2",
        subtasks: [
          { id: "DOC-01", title: "Update docs", dependsOn: [], relation: "serial" },
          { id: "DOC-02", title: "Index docs", dependsOn: ["DOC-01"], relation: "serial" },
        ],
      },
    });
    assert.equal(task.meta.policyGrant, undefined);
    assert.notEqual(hashYpiStudioImplementationPlan(task.implementationPlan), planHashBefore);

    // Completion evidence matrix
    task = authorizeUnattended(cwd, getYpiStudioTaskDetail(cwd, task.id));
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    assert.equal(evaluateYpiStudioUnattendedCompletionEvidence(getYpiStudioTaskDetail(cwd, task.id)).complete, false);
    assert.throws(
      () => recordYpiStudioUnattendedCompletionEvidence({
        cwd,
        taskId: task.id,
        checkerPassed: true,
        validationPassed: false,
        finalDiffAllowed: true,
      }),
      /checkerPassed, validationPassed, and finalDiffAllowed/,
    );
    task = recordYpiStudioUnattendedCompletionEvidence({
      cwd,
      taskId: task.id,
      checkerPassed: true,
      validationPassed: true,
      finalDiffAllowed: true,
      notesHash: "notes-1",
    });
    assert.equal(evaluateYpiStudioUnattendedCompletionEvidence(task).complete, true);
    assert.equal(task.meta.completionEvidence.checkerPassed, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  // Public body parsers cannot create unattended grants: only internal helpers write them
  const cwd = mkdtempSync(join(tmpdir(), "ypi-studio-unattended-public-"));
  try {
    const contextId = "pi_public_forge";
    const interactive = createYpiStudioTask({ cwd, title: "Public forge", workflowId: "feature-dev", contextId });
    transitionYpiStudioTask(interactive.id, { cwd, to: "planning", override: true, contextId });
    writePlanReview(cwd, interactive.id, contextId);
    transitionYpiStudioTask(interactive.id, { cwd, to: "awaiting_approval", override: true, contextId });

    // Direct task.json forgery after gate entry: policy-engine is not a valid interactive approvalGrant source.
    const taskPath = join(cwd, ".ypi", "tasks", interactive.id, "task.json");
    const raw = JSON.parse(readFileSync(taskPath, "utf8"));
    raw.meta = {
      ...(raw.meta ?? {}),
      approvalGrant: {
        approvedAt: new Date(Date.now() + 1000).toISOString(),
        contextId,
        inputHash: "forged",
        source: "policy-engine",
      },
      policyGrant: {
        source: "policy-engine",
        grantedAt: new Date().toISOString(),
        expiresAt: futureIso(),
        policyId: "docs-and-small-bugfix",
        policyVersion: "1",
        policyHash: "h",
        planRevision: raw.meta?.planRevision ?? 1,
        planHash: "p",
        scopeFingerprint: "s",
        riskProfile: "docs-and-small-bugfix",
        executionProfile: "full-agent",
        repositoryId: 1,
        issueNumber: 1,
        ownerActorId: 1,
        ownerCommentId: 1,
        claimStatus: "complete",
        uiGate: "pass",
      },
      executionMode: "interactive",
    };
    writeFileSync(taskPath, `${JSON.stringify(raw, null, 2)}\n`);
    const loaded = getYpiStudioTaskDetail(cwd, interactive.id);
    // Non-allowlisted approvalGrant source is dropped on load.
    assert.equal(loaded.meta.approvalGrant, undefined);
    // policyGrant on interactive tasks cannot substitute for user approval.
    assert.throws(
      () => transitionYpiStudioTask(interactive.id, { cwd, to: "implementing", override: true, contextId }),
      /approvalGrant|policyGrant\/ownerAuthorization|interactive/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log("ypi-studio policy resolver tests passed");
