export type RegistryType = 'skills' | 'agents' | 'mcp';

export interface RegistryItem {
  name: string;
  path: string;
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegistryIndex {
  type: RegistryType;
  items: RegistryItem[];
  version: string;
  lastUpdated: string;
}

export interface SaveItemParams {
  type: RegistryType;
  name: string;
  content: string;
  path: string;
  tags?: string[];
  description?: string;
}

export interface SearchParams {
  type: RegistryType;
  query: string;
}

export interface ListParams {
  type: RegistryType;
}

export interface InitParams {
  type: RegistryType;
}

export interface GitHubFileParams {
  owner: string;
  repo: string;
  path: string;
  content?: string;
  message?: string;
}

export const REPOS: Record<RegistryType, string> = {
  skills: 'Skills',
  agents: 'Agentes',
  mcp: 'MCPs',
};

export const OWNER = 'Hashzin-0';

export interface DynamicExecutorParams {
  task: string;
  type?: 'skill' | 'agent' | 'mcp' | 'all';
  includeResources?: boolean;
}

export interface ResourceCapabilities {
  domains: string[];
  operations: string[];
  requiresStackContext: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  outputs: string[];
}

export interface DynamicExecutorResultItem {
  type: 'skill' | 'agent' | 'mcp';
  name: string;
  path: string;
  description: string;
  tags: string[];
  content: string;
  resources?: {
    references: { name: string; content: string }[];
    scripts: { name: string; content: string }[];
    agents: { name: string; content: string }[];
  };
  capabilities?: ResourceCapabilities;
  matchReason: string;
}

export interface DynamicExecutorResult {
  found: boolean;
  results: DynamicExecutorResultItem[];
  searchedTypes: string[];
  message: string;
}

export interface WebhookCommit {
  id: string;
  message: string;
  added: string[];
  removed: string[];
  modified: string[];
}

export interface WebhookPushPayload {
  ref: string;
  before: string;
  after: string;
  commits: WebhookCommit[];
  repository: {
    name: string;
    full_name: string;
  };
}

export type IndexChangeType = 'add' | 'update' | 'remove';

export interface IndexChange {
  type: IndexChangeType;
  path: string;
  content?: string;
}

export type SkillUsageStatus = 'success' | 'error' | 'timeout' | 'partial';

export interface SkillUsageLogEvent {
  event_id: string;
  run_id: string;
  session_id?: string;
  task: string;
  task_hash?: string;
  skill_name: string;
  skill_path?: string;
  skill_type?: 'skill' | 'agent' | 'mcp' | 'all';
  status: SkillUsageStatus;
  error?: string;
  latency_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface LogIngestResponse {
  success: boolean;
  message: string;
  event_id?: string;
}

export interface ImproverParams {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  minSamples?: number;
  includeSuggestions?: boolean;
}
