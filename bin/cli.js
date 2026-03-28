#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MCP_URL = 'https://github-registry.onrender.com/mcp';
const CONFIG_DIR = join(homedir(), '.config', 'opencode');
const CONFIG_FILE = join(CONFIG_DIR, 'opencode.json');

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  
  if (!existsSync(CONFIG_FILE)) {
    return {
      $schema: 'https://opencode.ai/config.json',
      mcp: {}
    };
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    if (!config.mcp) {
      config.mcp = {};
    }
    return config;
  } catch (error) {
    console.error('Error reading config file:', error.message);
    return {
      $schema: 'https://opencode.ai/config.json',
      mcp: {}
    };
  }
}

function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function setupMCP() {
  const config = loadConfig();
  
  if (config.mcp['github-registry']) {
    if (config.mcp['github-registry'].url === MCP_URL) {
      console.log('✅ GitHub Registry MCP already configured!');
      console.log(`   URL: ${MCP_URL}`);
      return;
    }
  }

  config.mcp['github-registry'] = {
    type: 'remote',
    url: MCP_URL,
    enabled: true
  };

  saveConfig(config);
  
  console.log('✅ GitHub Registry MCP configured successfully!');
  console.log(`   URL: ${MCP_URL}`);
  console.log(`   Config file: ${CONFIG_FILE}`);
  console.log('');
  console.log('Restart OpenCode to use the MCP server.');
}

setupMCP();
