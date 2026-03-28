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
  matchReason: string;
}

export interface DynamicExecutorResult {
  found: boolean;
  results: DynamicExecutorResultItem[];
  searchedTypes: string[];
  message: string;
}