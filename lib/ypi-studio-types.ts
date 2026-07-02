export interface YpiStudioAgentFrontmatter {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
}

export interface YpiStudioAgent {
  key: string;
  id: string;
  fileName: string;
  name: string;
  description: string;
  version?: number;
  pathLabel: string;
  content: string;
  truncated: boolean;
  isDefault: boolean;
  modifiedAt?: string;
  frontmatter: YpiStudioAgentFrontmatter;
  readError?: string;
}

export interface YpiStudioAgentWriteResult {
  id: string;
  fileName: string;
  pathLabel: string;
  status: "created" | "skipped";
}

export interface YpiStudioAgentsResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;
  agents: YpiStudioAgent[];
  missingDefaultAgents: string[];
  errors: Array<{ fileName?: string; pathLabel?: string; message: string }>;
}

export interface YpiStudioAgentsInitResponse {
  cwd: string;
  pathLabel: string;
  created: YpiStudioAgentWriteResult[];
  skipped: YpiStudioAgentWriteResult[];
  agents: YpiStudioAgentsResponse;
}
