#!/usr/bin/env node
/* eslint-env node */

// Builds the web app for the Android shell and copies it into android/ ("npm run android:sync").
// VITE_API_BASE_URL is baked into the build: it defaults to the public API and must be https (the capture reader
// refuses cleartext, and the WebView origin https://localhost is what the API's CORS accepts).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_API = 'https://recta-api.maxsueleinstein.dev';
const apiUrl = process.env.VITE_API_BASE_URL || DEFAULT_API;

if (!apiUrl.startsWith('https://')) {
  console.error(`VITE_API_BASE_URL must start with https:// (got "${apiUrl}").`);
  process.exit(1);
}

function run(label, script, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_API_BASE_URL: apiUrl },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`API address in this build: ${apiUrl}`);
run('vite build', 'node_modules/vite/bin/vite.js', ['build']);
run('cap sync android', 'node_modules/@capacitor/cli/bin/capacitor', ['sync', 'android']);
