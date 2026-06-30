export interface TrellisWorkflowWarning {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  lineStart?: number;
  lineEnd?: number;
  nodeId?: string;
}

export interface TrellisWorkflowStep {
  id: string;
  stepNumber?: string;
  title: string;
  lineStart: number;
  lineEnd: number;
  body?: string;
  required?: boolean;
  once?: boolean;
  repeatable?: boolean;
}

export interface TrellisWorkflowPhase {
  id: string;
  title: string;
  phaseNumber?: string;
  lineStart: number;
  lineEnd: number;
  steps: TrellisWorkflowStep[];
  summary?: string;
  body?: string;
}

export interface TrellisWorkflowStateBlock {
  status: string;
  id: string;
  body: string;
  lineStart: number;
  lineEnd: number;
  relatedPhaseId?: string;
}

export interface TrellisWorkflowCommand {
  name: string;
  lineStart: number;
  lineEnd: number;
}

export interface TrellisWorkflowRoutingItem {
  intent: string;
  skill: string;
  lineStart: number;
  lineEnd: number;
}

export interface TrellisWorkflowProjection {
  title?: string;
  phases: TrellisWorkflowPhase[];
  states: TrellisWorkflowStateBlock[];
  taskCommands: TrellisWorkflowCommand[];
  skillRouting: TrellisWorkflowRoutingItem[];
  rawLineCount: number;
}

export interface TrellisWorkflowResponse {
  cwd: string;
  exists: boolean;
  pathLabel: ".trellis/workflow.md";
  modifiedAt?: string;
  truncated: boolean;
  workflow?: TrellisWorkflowProjection;
  warnings: TrellisWorkflowWarning[];
}

export interface TrellisWorkflowAssistNode {
  id: string;
  kind: "workflow" | "phase" | "step" | "state";
  title: string;
  lineStart: number;
  lineEnd: number;
  body: string;
}

export interface TrellisWorkflowAssistRequest {
  cwd: string;
  node: TrellisWorkflowAssistNode;
}

export interface TrellisWorkflowAssistResponse {
  summary: string;
  translation: string;
  keyActions: string[];
  cautions: string[];
  model?: { provider: string; modelId: string };
}
