#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { globSync } from 'glob';

const MCP_URL = 'https://github-registry.onrender.com/mcp';
const CONFIG_DIR = join(homedir(), '.config', 'opencode');
const CONFIG_FILE = join(CONFIG_DIR, 'opencode.json');

const BOX_WIDTH = 58;

function printLine(text) {
  const padding = Math.max(0, BOX_WIDTH - 2 - text.length);
  console.log('║  ' + text + ' '.repeat(padding) + '║');
}

function printBoxHeader() {
  console.log('╔' + '═'.repeat(BOX_WIDTH) + '╗');
  printLine('🚀 GitHub Registry MCP - Setup');
  console.log('╠' + '═'.repeat(BOX_WIDTH) + '╣');
}

function printStage1() {
  printLine('⏳ [1/6] Iniciando configuração...');
}

function printStage2() {
  printLine('⚙️  [2/6] Criando operador...');
  printLine('    └── MCP Server');
}

function printStage3() {
  printLine('🌍 [3/6] Configurando ambiente...');
  printLine('    └── Verificando');
}

function printStage4(current, total) {
  const percent = Math.round((current / total) * 10);
  const bar = '█'.repeat(Math.max(0, percent)) + '░'.repeat(10 - Math.max(0, percent));
  printLine('📂 [4/6] Criando ambiente (escaneando projeto)');
  printLine(`    └── [ ${bar} ] ${current}/${total} arquivos`);
}

function printStage5(progress) {
  const percent = Math.round(progress);
  const bar = '█'.repeat(Math.max(0, Math.round(percent / 10))) + '░'.repeat(10 - Math.max(0, Math.round(percent / 10)));
  printLine('⚙️  [5/6] Aplicando configuração');
  printLine(`    └── [ ${bar} ] ${percent}%`);
}

function printStage6(timeMs, results) {
  const seconds = (timeMs / 1000).toFixed(1);
  
  let message = '';
  const parts = [];
  
  if (results.mcpCreated) parts.push('MCP');
  if (results.gitignoreUpdated) parts.push('Git');
  if (results.contextCreated || results.contextUpdated) parts.push('Contexto');
  
  if (parts.length === 0) {
    message = 'Ambiente já está configurado';
  } else if (parts.length === 3) {
    message = 'MCP, Git e Contexto foram criados';
  } else if (results.mcpCreated && results.gitignoreUpdated && results.contextUpdated) {
    message = 'MCP e Git criados, Contexto atualizado';
  } else if (results.mcpCreated && results.contextCreated) {
    message = 'MCP e Contexto foram criados';
  } else if (results.gitignoreUpdated && results.contextCreated) {
    message = 'Git e Contexto foram atualizados';
  } else if (results.gitignoreUpdated && results.contextUpdated) {
    message = 'Git e Contexto foram atualizados';
  } else if (results.contextCreated) {
    message = 'Contexto foi criado';
  } else if (results.contextUpdated) {
    message = 'Contexto foi atualizado';
  } else if (results.gitignoreUpdated) {
    message = 'Git foi atualizado';
  } else if (results.mcpCreated) {
    message = 'MCP foi criado';
  }
  
  printLine(`✅ [6/6] Concluído! (${seconds}s)`);
  printLine(`    └── ${message}`);
}

function printSeparator() {
  console.log('╟─' + '─'.repeat(BOX_WIDTH) + '─╢');
}

function printBoxFooter() {
  console.log('╚' + '═'.repeat(BOX_WIDTH) + '╝');
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  
  if (!existsSync(CONFIG_FILE)) {
    return { $schema: 'https://opencode.ai/config.json', mcp: {} };
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    if (!config.mcp) config.mcp = {};
    return config;
  } catch {
    return { $schema: 'https://opencode.ai/config.json', mcp: {} };
  }
}

function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function isMCPConfigured() {
  const config = loadConfig();
  return config.mcp['github-registry'] && config.mcp['github-registry'].url === MCP_URL;
}

function needsContextRefresh() {
  const contextPath = join(process.cwd(), '.opencode', 'stack-context.md');
  const packagePath = join(process.cwd(), 'package.json');
  
  if (!existsSync(contextPath)) return true;
  if (!existsSync(packagePath)) return true;
  
  try {
    const contextMtime = statSync(contextPath).mtimeMs;
    const packageMtime = statSync(packagePath).mtimeMs;
    return packageMtime > contextMtime;
  } catch {
    return true;
  }
}

function isGitignoreUpdated() {
  const gitignorePath = join(process.cwd(), '.gitignore');
  if (!existsSync(gitignorePath)) return true;
  
  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    return content.includes('.opencode/');
  } catch {
    return true;
  }
}

function addToGitignore() {
  const gitignorePath = join(process.cwd(), '.gitignore');
  if (!existsSync(gitignorePath)) return false;
  
  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (content.includes('.opencode/')) return false;
    const newContent = content.trim() + '\n.opencode/\n';
    writeFileSync(gitignorePath, newContent);
    return true;
  } catch {
    return false;
  }
}

function quickPreScan() {
  const patterns = ['package.json', 'tsconfig.json', '*.config.*', 'src/**/*.ts', 'src/**/*.js', 'bin/**/*', 'supabase/**/*'];
  const files = new Set();
  for (const pattern of patterns) {
    try {
      const matches = globSync(pattern, { cwd: process.cwd() });
      matches.forEach(f => files.add(f));
    } catch {}
  }
  return files.size || 8;
}

function getEstimatedCount() {
  const base = 8;
  const hasPackage = existsSync(join(process.cwd(), 'package.json')) ? 2 : 0;
  const hasSrc = existsSync(join(process.cwd(), 'src')) ? 5 : 0;
  const hasSupabase = existsSync(join(process.cwd(), 'supabase')) ? 3 : 0;
  return base + hasPackage + hasSrc + hasSupabase;
}

function getFileCountWithFallback() {
  const preScan = quickPreScan();
  if (preScan > 0) return { method: 'pre-scan', count: preScan };
  return { method: 'estimated', count: getEstimatedCount() };
}

function runStackSkill() {
  const prompt = [
    'Use the skill at https://github.com/Hashzin-0/Skills/utilities/stack-detector (contains multiple files, not just SKILL.md) to scan this project and generate context files.',
    'Create or refresh .opencode/stack-context.md with the project stack summary.',
    'Return only a short success message.'
  ].join(' ');

  const result = spawnSync('opencode', ['run', prompt], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  return result;
}

function setupMCP() {
  const startTime = Date.now();
  const results = { mcpCreated: false, gitignoreUpdated: false, contextCreated: false, contextUpdated: false };
  
  printBoxHeader();
  printStage1();
  
  const mcpConfigured = isMCPConfigured();
  const gitignoreNeeds = !isGitignoreUpdated();
  const contextNeeds = needsContextRefresh();
  const needsAnyStage = !mcpConfigured || gitignoreNeeds || contextNeeds;
  
  if (!needsAnyStage) {
    printSeparator();
    printStage6(Date.now() - startTime, results);
    printBoxFooter();
    return;
  }
  
  printSeparator();
  
  if (!mcpConfigured) {
    printStage2();
    const config = loadConfig();
    config.mcp['github-registry'] = { type: 'remote', url: MCP_URL, enabled: true };
    saveConfig(config);
    results.mcpCreated = true;
    printSeparator();
  }
  
  if (gitignoreNeeds) {
    printStage3();
    const updated = addToGitignore();
    if (updated) results.gitignoreUpdated = true;
    printSeparator();
  }
  
  if (contextNeeds) {
    const fileCountInfo = getFileCountWithFallback();
    const fileCount = fileCountInfo.count;
    
    printStage4(0, fileCount);
    printSeparator();
    printStage5(0);
    printSeparator();
    
    const skillResult = runStackSkill();
    
    if (!skillResult.error && skillResult.code === 0) {
      const contextPath = join(process.cwd(), '.opencode', 'stack-context.md');
      if (!existsSync(contextPath)) {
        results.contextCreated = true;
      } else {
        results.contextUpdated = true;
      }
    }
    
    printStage4(fileCount, fileCount);
    printSeparator();
    printStage5(100);
  } else {
    printStage5(100);
  }
  
  printSeparator();
  printStage6(Date.now() - startTime, results);
  printBoxFooter();
}

setupMCP();