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
  WebhookPushPayload,
  IndexChange,
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

class GitHubRegistryMCP extends Server {
  constructor() {
    super(
      {
        name: 'github-registry-mcp',
        version: '1.0.0',
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
      version: '1.0.0',
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
        index = { type, items: [], version: '1.0.0', lastUpdated: now };
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