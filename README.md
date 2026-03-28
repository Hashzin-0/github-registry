# GitHub Registry MCP Server

MCP Server para gerenciar Skills, Agentes e MCPs em repositórios GitHub.

## Funcionalidades

### Operações GitHub Básicas
- `github_read_file` - Ler arquivo de qualquer repositório
- `github_write_file` - Criar/editar arquivo em qualquer repositório
- `github_list_directory` - Listar conteúdo de diretório

### Operações de Registry
- `registry_init` - Inicializar estrutura do repositório (index.json + diretórios)
- `registry_save` - Salvar item e atualizar index.json automaticamente
- `registry_search` - Buscar por nome ou tags no índice
- `registry_list` - Listar todos os itens com agrupamento opcional
- `registry_get_index` - Obter o index.json cru

## Modos de Uso

### Modo Local (Stdio)
Para uso local no seu terminal ou IDE:

```bash
npm run start
```

### Modo HTTP (Nuvem)
Para deploy em servidor (Render, Railway, etc):

```bash
npm run start:http
```

O servidor vai rodar na porta 3000 (ou na porta definida pela variável PORT).

## Configuração

### Variável de Ambiente

O servidor precisa do token do GitHub. Configure via variável de ambiente:

```bash
export GITHUB_TOKEN=seu_token_aqui
```

### Configuração no OpenCode (Local)

```json
{
  "mcpServers": {
    "github-registry": {
      "command": "node",
      "args": ["/path/to/mcp-servers/github-registry/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "seu_token_aqui"
      }
    }
  }
}
```

### Configuração no OpenCode (Nuvem)

Após fazer o deploy, use a URL HTTP:

```json
{
  "mcpServers": {
    "github-registry": {
      "url": "https://seu-servico.onrender.com/mcp"
    }
  }
}
```

## Deploy na Nuvem

### Render

1. Conecte este repo ao Render
2. Configure as variáveis de ambiente:
   - `GITHUB_TOKEN` = seu token
3. Comando de build: `npm run build`
4. Comando de start: `npm run start:http`

### Railway

1. Conecte este repo ao Railway
2. Configure as variáveis de ambiente:
   - `GITHUB_TOKEN` = seu token
3. O Railway automaticamente detecta Node.js e faz o build

## Uso das Tools

### Inicializar um Registry

```javascript
// Inicializar registry de skills
await registry_init({ type: 'skills' })

// Inicializar registry de agentes
await registry_init({ type: 'agents' })

// Inicializar registry de MCPs
await registry_init({ type: 'mcp' })
```

### Salvar um Item

```javascript
await registry_save({
  type: 'skills',
  name: 'fetch-user-data',
  content: '# Fetch User Data\n\nSkill para buscar dados de usuário...',
  path: 'api',
  tags: ['api', 'user', 'fetch'],
  description: 'Fetch user data from API'
})
```

### Buscar Itens

```javascript
// Buscar por nome ou tag
await registry_search({ type: 'skills', query: 'api' })
```

### Listar Itens

```javascript
// Lista simples
await registry_list({ type: 'skills' })

// Lista agrupada por caminho
await registry_list({ type: 'skills', groupBy: 'path' })

// Lista agrupada por tags
await registry_list({ type: 'skills', groupBy: 'tags' })
```

## Estrutura dos Repositórios

Os repositórios devem seguir este padrão:

```
Skills/
├── index.json
├── api/
│   └── fetch-user-data.md
└── ai/
    └── summarizer.md

Agentes/
├── index.json
└── ...

MCPs/
└── index.json
```

### Estrutura do index.json

```json
{
  "type": "skills",
  "items": [
    {
      "name": "fetch-user-data",
      "path": "api/fetch-user-data.md",
      "tags": ["api", "user"],
      "description": "Fetch user data from API",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "version": "1.0.0",
  "lastUpdated": "2024-01-01T00:00:00Z"
}
```

## Instalação Rápida

Para configurar o GitHub Registry MCP no seu OpenCode, basta rodar:

```bash
npx ghr-mcp
```

Este comando configura automaticamente o MCP no seu OpenCode apontando para o servidor remoto.

Após a instalação, reinicie o OpenCode para usar as ferramentas do MCP.

## Desenvolvimento

```bash
# Install dependencies
npm install

# Build
npm run build

# Desenvolvimento com hot reload
npm run dev

# Modo local (stdio)
npm run start

# Modo HTTP (para deploy)
npm run start:http
```

## Licença

MIT
