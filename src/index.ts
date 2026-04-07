import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';
import express from 'express';
import crypto from 'crypto';
import { version } from '../package.json';
import {
  RegistryType,
  RegistryItem,
  RegistryIndex,
  SaveItemParams,
  SearchParams,
  ListParams,
  InitParams,
  GitHubFileParams,
  REPOS,
  OWNER,
  DynamicExecutorParams,
  ResourceCapabilities,
  WebhookPushPayload,
  IndexChange,
  SkillUsageLogEvent,
  ImproverParams,
} from './types.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set');
  console.error('Please set your GitHub Personal Access Token:');
  console.error('  export GITHUB_TOKEN=your_token_here');
  process.exit(1);
}

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const skillUsageLogSchema = z.object({
  event_id: z.string().min(1),
  run_id: z.string().min(1),
  session_id: z.string().optional(),
  task: z.string().min(1),
  task_hash: z.string().optional(),
  skill_name: z.string().min(1),
  skill_path: z.string().optional(),
  skill_type: z.enum(['skill', 'agent', 'mcp', 'all']).optional(),
  status: z.enum(['success', 'error', 'timeout', 'partial']),
  error: z.string().optional(),
  latency_ms: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

class GitHubRegistryMCP extends Server {
  constructor() {
    super(
      {
        name: 'github-registry-mcp',
        version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
  }

  private setupTools() {
    this.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'read_file',
          description: 'Read a file from a GitHub repository',
          inputSchema: {
            type: 'object',
            properties: {
              owner: { type: 'string', description: 'Repository owner' },
              repo: { type: 'string', description: 'Repository name' },
              path: { type: 'string', description: 'File path' },
            },
            required: ['owner', 'repo', 'path'],
          },
        },
        {
          name: 'write_file',
          description: 'Create or update a file in a GitHub repository',
          inputSchema: {
            type: 'object',
            properties: {
              owner: { type: 'string', description: 'Repository owner' },
              repo: { type: 'string', description: 'Repository name' },
              path: { type: 'string', description: 'File path' },
              content: { type: 'string', description: 'File content (base64 or plain text)' },
              message: { type: 'string', description: 'Commit message' },
            },
            required: ['owner', 'repo', 'path', 'content'],
          },
        },
        {
          name: 'list_directory',
          description: 'List contents of a directory in a GitHub repository',
          inputSchema: {
            type: 'object',
            properties: {
              owner: { type: 'string', description: 'Repository owner' },
              repo: { type: 'string', description: 'Repository name' },
              path: { type: 'string', description: 'Directory path (empty for root)' },
            },
            required: ['owner', 'repo'],
          },
        },
        {
          name: 'init',
          description: 'Initialize a registry repository structure (index.json + directories) if not exists',
          inputSchema: {
            type: 'object',
            properties: {
              type: { 
                type: 'string', 
                enum: ['skills', 'agents', 'mcp'],
                description: 'Registry type' 
              },
            },
            required: ['type'],
          },
        },
        {
          name: 'save',
          description: 'Save an item to the registry and automatically update index.json',
          inputSchema: {
            type: 'object',
            properties: {
              type: { 
                type: 'string', 
                enum: ['skills', 'agents', 'mcp'],
                description: 'Registry type' 
              },
              name: { type: 'string', description: 'Item name' },
              content: { type: 'string', description: 'File content' },
              path: { type: 'string', description: 'Directory path within the repo' },
              tags: { 
                type: 'array', 
                items: { type: 'string' },
                description: 'Tags for searching' 
              },
              description: { type: 'string', description: 'Item description' },
            },
            required: ['type', 'name', 'content', 'path'],
          },
        },
        {
          name: 'search',
          description: 'Search for items in the registry by name or tags',
          inputSchema: {
            type: 'object',
            properties: {
              type: { 
                type: 'string', 
                enum: ['skills', 'agents', 'mcp'],
                description: 'Registry type' 
              },
              query: { type: 'string', description: 'Search query' },
            },
            required: ['type', 'query'],
          },
        },
        {
          name: 'list',
          description: 'List all items in the registry with optional grouping',
          inputSchema: {
            type: 'object',
            properties: {
              type: { 
                type: 'string', 
                enum: ['skills', 'agents', 'mcp'],
                description: 'Registry type' 
              },
              groupBy: { 
                type: 'string', 
                enum: ['none', 'path', 'tags'],
                description: 'How to group items' 
              },
            },
            required: ['type'],
          },
        },
        {
          name: 'get_index',
          description: 'Get the raw index.json from a registry',
          inputSchema: {
            type: 'object',
            properties: {
              type: { 
                type: 'string', 
                enum: ['skills', 'agents', 'mcp'],
                description: 'Registry type' 
              },
            },
            required: ['type'],
          },
        },
        {
          name: 'dynamic_executor',
          description: 'Search and retrieve complete skill/agent/mcp content from the registry on-demand. Use this when you need to execute a skill, agent, or MCP that is not available locally. It searches the remote registry and returns the full content including SKILL.md and optionally references, scripts, and agents.',
          inputSchema: {
            type: 'object',
            properties: {
              task: { 
                type: 'string', 
                description: 'Description of what you need to do (e.g., "code review", "create API", "security testing")' 
              },
              type: { 
                type: 'string', 
                enum: ['skill', 'agent', 'mcp', 'all'],
                description: 'Type of resource to search. If not specified, searches all available registries'
              },
              includeResources: { 
                type: 'boolean', 
                description: 'Also fetch references/, scripts/, and other resources if available',
                default: false
              }
            },
            required: ['task']
          },
        },
        {
          name: 'skill_improver',
          description: 'Analyze skill usage logs and return quality insights/suggestions',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              dateFrom: { type: 'string', description: 'ISO date-time filter start' },
              dateTo: { type: 'string', description: 'ISO date-time filter end' },
              minSamples: { type: 'number', default: 5 },
              includeSuggestions: { type: 'boolean', default: true },
            },
          },
        },
        {
          name: 'agent_improver',
          description: 'Analyze agent usage logs and return quality insights/suggestions',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              dateFrom: { type: 'string', description: 'ISO date-time filter start' },
              dateTo: { type: 'string', description: 'ISO date-time filter end' },
              minSamples: { type: 'number', default: 5 },
              includeSuggestions: { type: 'boolean', default: true },
            },
          },
        },
        {
          name: 'import_skill',
          description: 'Import a specific skill by name from remote registry',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
        {
          name: 'import_skills',
          description: 'Import all skills from remote registry',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'import_agent',
          description: 'Import a specific agent by name from remote registry',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
        {
          name: 'import_agents',
          description: 'Import all agents from remote registry',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'import_mcp',
          description: 'Import a specific MCP item by name from remote registry',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
        {
          name: 'import_mcps',
          description: 'Import all MCP items from remote registry',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }));

    this.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;

      try {
        switch (name) {
          case 'read_file':
            return await this.githubReadFile(args as unknown as { owner: string; repo: string; path: string });
          
          case 'write_file':
            return await this.githubWriteFile(args as unknown as GitHubFileParams);
          
          case 'list_directory':
            return await this.githubListDirectory(args as unknown as { owner: string; repo: string; path?: string });
          
          case 'init':
            return await this.registryInit(args as unknown as InitParams);
          
          case 'save':
            return await this.registrySave(args as unknown as SaveItemParams);
          
          case 'search':
            return await this.registrySearch(args as unknown as SearchParams);
          
          case 'list':
            return await this.registryList(args as unknown as ListParams & { groupBy?: 'none' | 'path' | 'tags' });
          
          case 'get_index':
            return await this.registryGetIndex(args as unknown as { type: RegistryType });
          
          case 'dynamic_executor':
            return await this.dynamicExecutor(args as unknown as DynamicExecutorParams);

          case 'skill_improver':
            return await this.improverCore('skill', args as unknown as ImproverParams);

          case 'agent_improver':
            return await this.improverCore('agent', args as unknown as ImproverParams);

          case 'import_skill':
            return await this.importCore('skill', 'one', args as unknown as { name: string });

          case 'import_skills':
            return await this.importCore('skill', 'all');

          case 'import_agent':
            return await this.importCore('agent', 'one', args as unknown as { name: string });

          case 'import_agents':
            return await this.importCore('agent', 'all');

          case 'import_mcp':
            return await this.importCore('mcp', 'one', args as unknown as { name: string });

          case 'import_mcps':
            return await this.importCore('mcp', 'all');
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async githubReadFile(args: { owner: string; repo: string; path: string }) {
    const { owner, repo, path } = args;
    
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if (Array.isArray(response.data)) {
      return {
        content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
      };
    }

    const fileContent = (response.data as any).content;
    if (!fileContent) {
      return {
        content: [{ type: 'text', text: 'Error: Not a file or empty content' }],
        isError: true,
      };
    }

    const content = Buffer.from(fileContent, 'base64').toString('utf-8');
    return {
      content: [{ type: 'text', text: content }],
    };
  }

  private async githubWriteFile(args: GitHubFileParams) {
    const { owner, repo, path, content = '', message } = args;
    
    const encoded = Buffer.from(content).toString('base64');

    try {
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: message || `chore: update ${path}`,
        content: encoded,
      });

      return {
        content: [{ type: 'text', text: `Successfully saved ${path} to ${owner}/${repo}` }],
      };
    } catch (error: any) {
      if (error.status === 404) {
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: message || `feat: create ${path}`,
          content: encoded,
        });
        return {
          content: [{ type: 'text', text: `Successfully created ${path} in ${owner}/${repo}` }],
        };
      }
      throw error;
    }
  }

  private async githubListDirectory(args: { owner: string; repo: string; path?: string }) {
    const { owner, repo, path = '' } = args;
    
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    const items = Array.isArray(response.data) ? response.data : [response.data];
    
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify(
          items.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type,
            size: item.size,
          })),
          null,
          2
        ),
      }],
    };
  }

  private async registryInit(args: InitParams) {
    const { type } = args;
    const repo = REPOS[type];
    
    try {
      await octokit.repos.getContent({
        owner: OWNER,
        repo,
        path: 'index.json',
      });
      
      return {
        content: [{ type: 'text', text: `Registry ${type} already initialized` }],
      };
    } catch (error: any) {
      if (error.status !== 404) throw error;
    }

    const initialIndex: RegistryIndex = {
      type,
      items: [],
      version,
      lastUpdated: new Date().toISOString(),
    };

    await this.githubWriteFile({
      owner: OWNER,
      repo,
      path: 'index.json',
      content: JSON.stringify(initialIndex, null, 2),
      message: `init: create ${type} registry`,
    });

    const dirs = ['.', 'agents', 'skills', 'mcp'];
    for (const dir of dirs) {
      if (dir === '.') continue;
      try {
        await octokit.repos.getContent({
          owner: OWNER,
          repo,
          path: dir,
        });
      } catch (error: any) {
        if (error.status === 404) {
          await this.githubWriteFile({
            owner: OWNER,
            repo,
            path: `${dir}/.gitkeep`,
            content: '',
            message: `init: create ${dir} directory`,
          });
        }
      }
    }

    return {
      content: [{ type: 'text', text: `Successfully initialized ${type} registry` }],
    };
  }

  private async registrySave(args: SaveItemParams) {
    const { type, name, content, path, tags = [], description = '' } = args;
    const repo = REPOS[type];
    
    const fullPath = path ? `${path}/${name}.md` : `${name}.md`;
    const now = new Date().toISOString();

    await this.githubWriteFile({
      owner: OWNER,
      repo,
      path: fullPath,
      content,
      message: `feat(${type}): add ${name}`,
    });

    const index = await this.getIndexInternal(type);
    
    const existingIndex = index.items.findIndex(item => item.name === name);
    const item: RegistryItem = {
      name,
      path: fullPath,
      tags,
      description: description || this.extractDescription(content),
      createdAt: existingIndex >= 0 ? index.items[existingIndex].createdAt : now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      index.items[existingIndex] = item;
    } else {
      index.items.push(item);
    }

    index.lastUpdated = now;

    await this.githubWriteFile({
      owner: OWNER,
      repo,
      path: 'index.json',
      content: JSON.stringify(index, null, 2),
      message: `chore(${type}): update index.json`,
    });

    return {
      content: [{ 
        type: 'text', 
        text: `Successfully saved ${name} to ${type} registry and updated index`,
      }],
    };
  }

  private extractDescription(content: string): string {
    const lines = content.split('\n');
    for (const line of lines.slice(0, 10)) {
      const match = line.match(/^#?\s*(?:description|descrição)[:\s]+(.+)/i);
      if (match) return match[1].trim();
    }
    return content.slice(0, 100).replace(/[#*`]/g, '').trim();
  }

  private async registrySearch(args: SearchParams) {
    const { type, query } = args;
    const index = await this.getIndexInternal(type);
    
    const queryLower = query.toLowerCase();
    const results = index.items.filter(item => 
      item.name.toLowerCase().includes(queryLower) ||
      item.tags.some(tag => tag.toLowerCase().includes(queryLower)) ||
      item.description.toLowerCase().includes(queryLower)
    );

    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify(results, null, 2),
      }],
    };
  }

  private async registryList(args: ListParams & { groupBy?: 'none' | 'path' | 'tags' }) {
    const { type, groupBy = 'none' } = args;
    const index = await this.getIndexInternal(type);

    if (groupBy === 'none') {
      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify(index.items, null, 2),
        }],
      };
    }

    const grouped: Record<string, RegistryItem[]> = {};
    
    for (const item of index.items) {
      const key = groupBy === 'path' 
        ? item.path.split('/')[0] || 'root'
        : (item.tags[0] || 'untagged');
      
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }

    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify(grouped, null, 2),
      }],
    };
  }

  private async registryGetIndex(args: { type: RegistryType }) {
    const index = await this.getIndexInternal(args.type);
    
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify(index, null, 2),
      }],
    };
  }

  private async processWebhookPush(payload: WebhookPushPayload): Promise<void> {
    const { commits, repository } = payload;
    const repoName = repository.name;
    
    const registryType = this.getRegistryTypeFromRepo(repoName);
    if (!registryType) {
      console.log(`Webhook: Repo ${repoName} not a registry, skipping`);
      return;
    }

    const changes: IndexChange[] = [];
    
    for (const commit of commits) {
      const allFiles = [...commit.added, ...commit.modified, ...commit.removed];
      const mdFiles = allFiles.filter(f => f.endsWith('.md'));
      
      for (const file of mdFiles) {
        if (commit.added.includes(file) || commit.modified.includes(file)) {
          changes.push({ type: commit.added.includes(file) ? 'add' : 'update', path: file });
        } else if (commit.removed.includes(file)) {
          changes.push({ type: 'remove', path: file });
        }
      }
    }

    if (changes.length === 0) {
      console.log(`Webhook: No .md files changed in ${repoName}`);
      return;
    }

    console.log(`Webhook: Processing ${changes.length} changes in ${repoName}`);
    await this.updateIndexFromChanges(registryType, changes);
  }

  private getRegistryTypeFromRepo(repoName: string): RegistryType | null {
    for (const [type, repo] of Object.entries(REPOS)) {
      if (repo === repoName) return type as RegistryType;
    }
    return null;
  }

  private async updateIndexFromChanges(type: RegistryType, changes: IndexChange[]): Promise<void> {
    const repo = REPOS[type];
    const now = new Date().toISOString();
    
    let index: RegistryIndex;
    try {
      index = await this.getIndexInternal(type);
    } catch (error: any) {
      if (error.status === 404) {
        index = { type, items: [], version, lastUpdated: now };
      } else {
        throw error;
      }
    }

    for (const change of changes) {
      if (change.type === 'remove') {
        index.items = index.items.filter(item => item.path !== change.path);
      } else {
        const existingIndex = index.items.findIndex(item => item.path === change.path);
        
        let content = '';
        if (change.type === 'update' || existingIndex === -1) {
          try {
            const fileResult = await this.githubReadFile({
              owner: OWNER,
              repo,
              path: change.path,
            });
            content = fileResult.content[0].text;
          } catch (error: any) {
            console.error(`Error reading ${change.path}:`, error.message);
            continue;
          }
        }

        const fileName = change.path.split('/').pop()?.replace('.md', '') || '';
        const pathParts = change.path.replace('.md', '').split('/');
        pathParts.pop();
        const category = pathParts.join('/');

        const item: RegistryItem = {
          name: fileName,
          path: change.path,
          tags: this.extractTags(content),
          description: this.extractDescription(content),
          createdAt: existingIndex >= 0 ? index.items[existingIndex].createdAt : now,
          updatedAt: now,
        };

        if (existingIndex >= 0) {
          index.items[existingIndex] = item;
        } else {
          index.items.push(item);
        }
      }
    }

    index.lastUpdated = now;

    await this.githubWriteFile({
      owner: OWNER,
      repo,
      path: 'index.json',
      content: JSON.stringify(index, null, 2),
      message: `chore(${type}): sync index from webhook`,
    });

    console.log(`Webhook: Updated ${type} index with ${changes.length} changes`);
  }

  private extractTags(content: string): string[] {
    const tagsMatch = content.match(/tags?\s*[:=]\s*\[([^\]]+)\]/i);
    if (tagsMatch) {
      return tagsMatch[1].split(',').map(t => t.trim().replace(/["']/g, ''));
    }
    
    const yamlTagsMatch = content.match(/^---\s*[\r\n]+tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
    if (yamlTagsMatch) {
      return yamlTagsMatch[1].split('\n').map(t => t.replace(/^-\s*/, '').trim()).filter(Boolean);
    }
    
    return [];
  }

  private validateWebhookSignature(payload: string, signature: string | undefined): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret || !signature) {
      console.log('Webhook: No secret configured or no signature, allowing');
      return true;
    }
    
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }

  private async getIndexInternal(type: RegistryType): Promise<RegistryIndex> {
    try {
      const response = await octokit.repos.getContent({
        owner: OWNER,
        repo: REPOS[type],
        path: 'index.json',
      });
      
      if (Array.isArray(response.data)) {
        throw new Error('index.json is a directory');
      }
      
      const content = Buffer.from((response.data as any).content, 'base64').toString('utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.status === 404) {
        await this.registryInit({ type });
        return this.getIndexInternal(type);
      }
      throw error;
    }
  }

  private async dynamicExecutor(args: DynamicExecutorParams): Promise<any> {
    const { task, type = 'all', includeResources = false } = args;
    
    const typesToSearch = type === 'all' 
      ? (['skill', 'agent', 'mcp'] as const)
      : [type];
    
    const results = [];
    
    for (const t of typesToSearch) {
      const registryType = t === 'skill' ? 'skills' : t === 'agent' ? 'agents' : 'mcp';
      const repoKey = registryType as RegistryType;
      
      try {
        const searchResults = await this.registrySearch({ type: registryType, query: task });
        const parsed = JSON.parse(searchResults.content[0].text);
        
        if (parsed.length > 0) {
          const bestMatch = parsed[0];
          
          const mainContent = await this.githubReadFile({
            owner: OWNER,
            repo: REPOS[repoKey],
            path: bestMatch.path
          });
          
          const matchReason = this.buildMatchReason(bestMatch, task);
          
          const result: any = {
            type: t,
            name: bestMatch.name,
            path: bestMatch.path,
            description: bestMatch.description,
            tags: bestMatch.tags || [],
            content: mainContent.content[0].text,
            capabilities: this.inferCapabilities({
              type: t,
              path: bestMatch.path,
              tags: bestMatch.tags || [],
              description: bestMatch.description,
            }),
            matchReason
          };
          
          if (includeResources) {
            const resources = await this.fetchSkillResources(registryType, bestMatch.path);
            if (resources) result.resources = resources;
          }
          
          results.push(result);
        }
      } catch (error: any) {
        if (error.status !== 404) {
          console.error(`Error searching ${t}:`, error.message);
        }
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          found: results.length > 0,
          results,
          searchedTypes: [...typesToSearch],
          message: results.length > 0 
            ? `Found ${results.length} result(s)`
            : 'No matching skill/agent/mcp found in registry'
        }, null, 2)
      }]
    };
  }

  private buildMatchReason(item: any, task: string): string {
    const taskLower = task.toLowerCase();
    const reasons: string[] = [];
    
    if (item.name.toLowerCase().includes(taskLower) || taskLower.includes(item.name.toLowerCase())) {
      reasons.push(`name matches "${item.name}"`);
    }
    
    if (item.tags && item.tags.some((tag: string) => taskLower.includes(tag.toLowerCase()))) {
      const matchedTags = item.tags.filter((tag: string) => taskLower.includes(tag.toLowerCase()));
      reasons.push(`tags: ${matchedTags.join(', ')}`);
    }
    
    if (item.description && item.description.toLowerCase().includes(taskLower.split(' ')[0])) {
      reasons.push('description keyword match');
    }
    
    return reasons.length > 0 ? reasons.join('; ') : 'best match from search results';
  }

  private async fetchSkillResources(registryType: string, itemPath: string): Promise<any | null> {
    const basePath = itemPath.replace(/\.md$/, '');
    
    const resources: any = {
      references: [],
      scripts: [],
      agents: []
    };
    
    const subdirs = ['references', 'scripts', 'agents'];
    const repoKey = registryType as RegistryType;
    
    for (const subdir of subdirs) {
      try {
        const dirContent = await this.githubListDirectory({
          owner: OWNER,
          repo: REPOS[repoKey],
          path: `${basePath}/${subdir}`
        });
        
        const files = JSON.parse(dirContent.content[0].text);
        
        for (const file of files) {
          if (file.type === 'file') {
            const fileContent = await this.githubReadFile({
              owner: OWNER,
              repo: REPOS[repoKey],
              path: file.path
            });
            
            const resourceKey = subdir as 'references' | 'scripts' | 'agents';
            resources[resourceKey].push({
              name: file.name,
              content: fileContent.content[0].text
            });
          }
        }
      } catch (error: any) {
        // Directory doesn't exist, that's fine
      }
    }
    
    return resources.references.length > 0 || resources.scripts.length > 0 || resources.agents.length > 0
      ? resources
      : null;
  }

  private inferCapabilities(item: { type: 'skill' | 'agent' | 'mcp'; tags?: string[]; path?: string; description?: string }): ResourceCapabilities {
    const text = `${item.description || ''} ${(item.tags || []).join(' ')} ${item.path || ''}`.toLowerCase();
    const domains = ['backend', 'frontend', 'security', 'devops', 'data', 'ai']
      .filter(domain => text.includes(domain));
    const operations = ['analyze', 'generate', 'refactor', 'test', 'deploy', 'debug']
      .filter(op => text.includes(op));

    const riskLevel: ResourceCapabilities['riskLevel'] = /deploy|prod|security|auth/.test(text)
      ? 'high'
      : /write|edit|modify/.test(text)
        ? 'medium'
        : 'low';

    return {
      domains: domains.length > 0 ? domains : ['general'],
      operations: operations.length > 0 ? operations : ['analyze'],
      requiresStackContext: text.includes('stack') || text.includes('context'),
      riskLevel,
      outputs: ['text/markdown'],
    };
  }

  private async improverCore(domain: 'skill' | 'agent', args: ImproverParams = {}) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for improver tools');
    }

    const {
      query = '',
      dateFrom,
      dateTo,
      minSamples = 5,
      includeSuggestions = true,
    } = args;

    const params = new URLSearchParams();
    params.set('select', 'skill_name,skill_type,status,error,latency_ms,created_at');
    params.set('order', 'created_at.desc');
    params.set('limit', '500');
    params.set('skill_type', `eq.${domain}`);
    if (query) params.set('skill_name', `ilike.*${query}*`);
    if (dateFrom) params.set('created_at', `gte.${dateFrom}`);
    if (dateTo) params.set('created_at', `lte.${dateTo}`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/skill_usage_logs?${params.toString()}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Improver query failed: ${body || response.statusText}`);
    }

    const rows = await response.json() as Array<{
      skill_name: string;
      skill_type: string;
      status: string;
      error?: string;
      latency_ms?: number;
      created_at: string;
    }>;

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!grouped.has(row.skill_name)) grouped.set(row.skill_name, []);
      grouped.get(row.skill_name)!.push(row);
    }

    const insights = Array.from(grouped.entries()).map(([name, items]) => {
      const total = items.length;
      const success = items.filter(i => i.status === 'success').length;
      const errors = items.filter(i => i.status !== 'success');
      const avgLatency = items.filter(i => typeof i.latency_ms === 'number')
        .reduce((acc, item) => acc + (item.latency_ms || 0), 0) / Math.max(1, items.filter(i => typeof i.latency_ms === 'number').length);
      const topErrors = Object.entries(
        errors.reduce((acc, item) => {
          const key = item.error || item.status;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([error, count]) => ({ error, count }));

      const suggestions: string[] = [];
      if (includeSuggestions && total >= minSamples) {
        const successRate = success / total;
        if (successRate < 0.7) suggestions.push('Review prerequisites and add clearer execution checklist.');
        if (avgLatency > 8000) suggestions.push('Optimize heavy steps and split long-running operations.');
        if (topErrors.length > 0) suggestions.push(`Add guidance for frequent failures: ${topErrors[0].error}.`);
      }

      return {
        name,
        domain,
        samples: total,
        successRate: Number((success / Math.max(1, total)).toFixed(3)),
        avgLatencyMs: Number(avgLatency.toFixed(2)),
        topErrors,
        suggestions,
      };
    }).sort((a, b) => b.samples - a.samples);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          domain,
          filters: { query, dateFrom, dateTo, minSamples, includeSuggestions },
          totalRows: rows.length,
          insights,
        }, null, 2),
      }],
    };
  }

  private async importCore(kind: 'skill' | 'agent' | 'mcp', mode: 'one' | 'all', args?: { name: string }) {
    const registryType = kind === 'skill' ? 'skills' : kind === 'agent' ? 'agents' : 'mcp';
    const index = await this.getIndexInternal(registryType);
    const sourceRepo = REPOS[registryType];

    const selectedItems = mode === 'all'
      ? index.items
      : index.items.filter(item => item.name.toLowerCase() === (args?.name || '').toLowerCase());

    if (selectedItems.length === 0) {
      throw new Error(`No ${kind} found for ${mode === 'one' ? args?.name : 'all'} request`);
    }

    const imports = [];
    for (const item of selectedItems) {
      const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${sourceRepo}/main/${item.path}`;
      const capabilities = this.inferCapabilities({
        type: kind,
        path: item.path,
        tags: item.tags,
        description: item.description,
      });

      let targetPath = '';
      if (kind === 'skill') {
        targetPath = `.opencode/skills/${item.path.replace(/\/SKILL\.md$/i, '').replace(/\.md$/i, '')}/SKILL.md`;
      } else if (kind === 'agent') {
        targetPath = `.opencode/agents/${item.name}.md`;
      } else {
        targetPath = `.opencode/mcps/${item.name}.md`;
      }

      imports.push({
        name: item.name,
        sourcePath: item.path,
        rawUrl,
        targetPath,
        capabilities,
      });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          kind,
          mode,
          count: imports.length,
          imports,
          message: 'Import plan ready. Fetch rawUrl and write each item to targetPath in your OpenCode workspace.',
        }, null, 2),
      }],
    };
  }
}

const server = new GitHubRegistryMCP();

const useHttp = process.argv.includes('--http');

async function startServer() {
  if (useHttp) {
    const app = express();
    app.use(express.json());

    const PORT = parseInt(process.env.PORT || '3000', 10);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await server.connect(transport);

    app.post('/mcp', async (req, res) => {
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    
    app.get('/health', (req, res) => {
      const health: { status: string; timestamp: string; services: { github: string } } = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          github: GITHUB_TOKEN ? 'configured' : 'missing_token',
        },
      };
      
      if (!GITHUB_TOKEN) {
        health.status = 'degraded';
      }
      
      res.status(GITHUB_TOKEN ? 200 : 503).json(health);
    });

    app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
      try {
        const signature = req.headers['x-hub-signature-256'] as string | undefined;
        const payloadString = req.body.toString();
        
        const serverInstance = server as unknown as { validateWebhookSignature: (payload: string, signature: string | undefined) => boolean; processWebhookPush: (payload: WebhookPushPayload) => Promise<void> };
        
        if (!serverInstance.validateWebhookSignature(payloadString, signature)) {
          console.error('Webhook: Invalid signature');
          return res.status(401).send('Invalid signature');
        }

        const payload = JSON.parse(payloadString) as WebhookPushPayload;
        
        if (payload.ref?.startsWith('refs/heads/')) {
          const branch = payload.ref.replace('refs/heads/', '');
          console.log(`Webhook: Received push to ${branch}`);
          
          await serverInstance.processWebhookPush(payload);
        }
        
        res.status(200).send('OK');
      } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Internal error');
      }
    });

    app.post('/logs/skill-usage', async (req, res) => {
      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          return res.status(503).json({
            success: false,
            message: 'Logging unavailable: SUPABASE_URL or SUPABASE_ANON_KEY not configured',
          });
        }

        const expectedApiKey = process.env.LOG_API_KEY;
        if (expectedApiKey) {
          const providedApiKey = req.headers['x-log-api-key'];
          if (!providedApiKey || providedApiKey !== expectedApiKey) {
            return res.status(401).json({
              success: false,
              message: 'Unauthorized log ingestion request',
            });
          }
        }

        const parsed = skillUsageLogSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            success: false,
            message: `Invalid payload: ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
          });
        }

        const event: SkillUsageLogEvent = parsed.data;
        const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/skill_usage_logs`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'content-type': 'application/json',
            prefer: 'return=minimal',
          },
          body: JSON.stringify({
            event_id: event.event_id,
            run_id: event.run_id,
            session_id: event.session_id,
            task: event.task,
            task_hash: event.task_hash,
            skill_name: event.skill_name,
            skill_path: event.skill_path,
            skill_type: event.skill_type,
            status: event.status,
            error: event.error,
            latency_ms: event.latency_ms,
            metadata: event.metadata ?? {},
          }),
        });

        if (!insertResponse.ok) {
          const errorBody = await insertResponse.text();
          if (insertResponse.status === 409 || errorBody.includes('23505')) {
            return res.status(200).json({
              success: true,
              message: 'Duplicate event ignored (idempotent)',
              event_id: event.event_id,
            });
          }

          return res.status(500).json({
            success: false,
            message: `Failed to persist log: ${errorBody || insertResponse.statusText}`,
          });
        }

        return res.status(202).json({
          success: true,
          message: 'Log ingested successfully',
          event_id: event.event_id,
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: `Unexpected logging error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`GitHub Registry MCP Server running on http://0.0.0.0:${PORT}`);
      console.log(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('GitHub Registry MCP Server running in stdio mode');
  }
}

startServer().catch(console.error);
