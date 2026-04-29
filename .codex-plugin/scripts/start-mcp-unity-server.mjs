#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, '../..');
const serverDir = resolve(pluginRoot, 'Server~');
const serverEntry = resolve(serverDir, 'build/index.js');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runSetup(command, args) {
  const result = spawnSync(command, args, {
    cwd: serverDir,
    env: process.env,
    encoding: 'utf8'
  });

  if (result.stdout) {
    process.stderr.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(resolve(serverDir, 'node_modules'))) {
  runSetup(npmCommand, ['install']);
}

if (!existsSync(serverEntry)) {
  runSetup(npmCommand, ['run', 'build']);
}

const child = spawn(process.execPath, [serverEntry], {
  cwd: serverDir,
  env: process.env,
  stdio: 'inherit'
});

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
