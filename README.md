# GitHub Registry MCP Server

MCP Server para gerenciar Skills, Agentes e MCPs em repositórios GitHub.

## Funcionalidades

### Operações GitHub Básicas
- `read_file` - Ler arquivo de qualquer repositório
- `write_file` - Criar/editar arquivo em qualquer repositório
- `list_directory` - Listar conteúdo de diretório

### Operações de Registry
- `init` - Inicializar estrutura do repositório (index.json + diretórios)
- `save` - Salvar item e atualizar index.json automaticamente
- `search` - Buscar por nome ou tags no índice
- `list` - Listar todos os itens com agrupamento opcional
- `get_index` - Obter o index.json cru

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
   - `GITHUB_WEBHOOK_SECRET` = (opcional) secret para validar webhook
3. Comando de build: `npm run build`
4. Comando de start: `npm run start:http`

### Railway

1. Conecte este repo ao Railway
2. Configure as variáveis de ambiente:
   - `GITHUB_TOKEN` = seu token
   - `GITHUB_WEBHOOK_SECRET` = (opcional) secret para validar webhook
3. O Railway automaticamente detecta Node.js e faz o build

## Webhook para Auto-Update do Index

O servidor suporta webhooks para atualizar automaticamente o `index.json` quando arquivos `.md` são adicionados, modificados ou removidos nos repositórios (Skills, Agentes, MCPs).

### Configuração

1. **Deploy o servidor** (Render/Railley) e obtenha a URL (ex: `https://seu-servico.onrender.com`)

2. **Configure o webhook** em cada repositório (Skills, Agentes, MCPs):

   - Vá em Settings > Webhooks > Add webhook
   - Payload URL: `https://seu-servico.onrender.com/webhook`
   - Content type: `application/json`
   - Events: Selecione "Pushes"
   - Secret: (opcional) mesmo valor de `GITHUB_WEBHOOK_SECRET`

3. **Variáveis de ambiente** (opcional):
   - `GITHUB_WEBHOOK_SECRET` - Secret para validar assinatura do webhook

### Como funciona

Quando alguém faz push para o repositório:
1. O GitHub envia um webhook para `/webhook`
2. O servidor detecta arquivos `.md` alterados
3. Para cada arquivo:
   - **Adicionado/Modificado**: Lê o conteúdo, extrai name, tags e description, atualiza o index
   - **Removido**: Remove o item do index
4. Commita as mudanças no `index.json` automaticamente

### Exemplo de index.json gerado

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
      "updatedAt": "2024-01-02T00:00:00Z"
    }
  ],
  "version": "1.0.0",
  "lastUpdated": "2024-01-02T00:00:00Z"
}
```

### Tags no arquivo .md

O servidor extrai tags automaticamente. Use um destes formatos:

```markdown
<!-- Formato 1: JSON array -->
tags: [api, user, fetch]

<!-- Formato 2: YAML frontmatter -->
---
tags:
  - api
  - user
  - fetch
---
```

## Uso das Tools

### Inicializar um Registry

```javascript
// Inicializar registry de skills
await init({ type: 'skills' })

// Inicializar registry de agentes
await init({ type: 'agents' })

// Inicializar registry de MCPs
await init({ type: 'mcp' })
```

### Salvar um Item

```javascript
await save({
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
await search({ type: 'skills', query: 'api' })
```

### Listar Itens

```javascript
// Lista simples
await list({ type: 'skills' })

// Lista agrupada por caminho
await list({ type: 'skills', groupBy: 'path' })

// Lista agrupada por tags
await list({ type: 'skills', groupBy: 'tags' })
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
