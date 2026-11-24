#!/usr/bin/env node
// Builds release/mcp-server-gsc-<version>.mcpb from a clean production install.
// The output stays outside dist/ because npm publishes dist/.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const output = join(root, 'release', `mcp-server-gsc-${packageJson.version}.mcpb`);
const stage = mkdtempSync(join(tmpdir(), 'mcp-server-gsc-mcpb-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

try {
  run('npm', ['run', 'build'], root);

  for (const path of ['dist', 'patches', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) {
    cpSync(join(root, path), join(stage, path), { recursive: true });
  }

  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  manifest.version = packageJson.version;
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
  run('npx', ['--yes', MCPB_CLI, 'validate', 'manifest.json'], stage);
  mkdirSync(dirname(output), { recursive: true });
  run('npx', ['--yes', MCPB_CLI, 'pack', stage, output], stage);
  console.log(`Created ${output}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
