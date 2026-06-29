export type TrellisSetupRecommendedAction = "select-workspace" | "fix-prerequisites" | "initialize" | "update" | "ready";

export interface TrellisRequirementStatus {
  ok: boolean;
  required: string;
  version?: string;
  command?: string;
  error?: string;
}

export interface TrellisCliStatus {
  installed: boolean;
  version?: string;
  upgradeCommandAvailable?: boolean;
  error?: string;
}

export interface TrellisProjectStatus {
  hasTrellisDir: boolean;
  hasTasksDir: boolean;
  version?: string;
  hasDeveloperIdentity: boolean;
  developerName?: string;
}

export interface TrellisSetupStatus {
  cwd: string;
  supportedOs: boolean;
  platform: NodeJS.Platform;
  node: TrellisRequirementStatus;
  python: TrellisRequirementStatus;
  cli: TrellisCliStatus;
  project: TrellisProjectStatus;
  suggestedDeveloperName: string;
  canInitialize: boolean;
  canUpdate: boolean;
  blockingReasons: string[];
  recommendedAction: TrellisSetupRecommendedAction;
}

export interface TrellisCommandResponse {
  success: boolean;
  output: string;
  status: TrellisSetupStatus;
  error?: string;
}
