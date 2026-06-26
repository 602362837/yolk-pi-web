export type TrellisTaskPhase = "plan" | "execute" | "check" | "finish";
export type TrellisTaskStageStatus = "done" | "active" | "pending";

export interface TrellisTaskProgressStage {
  id: TrellisTaskPhase;
  label: string;
  status: TrellisTaskStageStatus;
  details: string[];
}

export interface TrellisTaskProgress {
  phase: TrellisTaskPhase;
  label: string;
  percent: number;
  stages: TrellisTaskProgressStage[];
}

export interface TrellisTaskArtifacts {
  prd: boolean;
  design: boolean;
  implement: boolean;
  implementContext: boolean;
  checkContext: boolean;
}

export interface TrellisTaskSummary {
  key: string;
  dirName: string;
  archiveMonth?: string;
  isArchived: boolean;
  id: string;
  name: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  assignee?: string;
  creator?: string;
  createdAt?: string;
  completedAt?: string | null;
  branch?: string | null;
  baseBranch?: string | null;
  worktreePath?: string | null;
  commit?: string | null;
  prUrl?: string | null;
  parent?: string | null;
  children: string[];
  subtasks: string[];
  childProgress: {
    total: number;
    completed: number;
  };
  progress: TrellisTaskProgress;
  hasArtifacts: TrellisTaskArtifacts;
  readError?: string;
}

export interface TrellisDocument {
  fileName: "prd.md" | "design.md" | "implement.md";
  content: string;
  truncated: boolean;
}

export interface TrellisTaskDetail extends TrellisTaskSummary {
  pathLabel: string;
  relatedFiles: string[];
  notes?: string;
  meta: Record<string, unknown>;
  documents: {
    prd?: TrellisDocument;
    design?: TrellisDocument;
    implement?: TrellisDocument;
  };
  manifests: {
    implementCount: number;
    checkCount: number;
  };
}

export interface TrellisTaskReadError {
  key?: string;
  pathLabel?: string;
  message: string;
}

export interface TrellisTasksResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;
  tasks: TrellisTaskSummary[];
  statusCounts: Record<string, number>;
  archivedCount: number;
  errors: TrellisTaskReadError[];
}
