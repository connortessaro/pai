// Runs from `npm version` (the "version" script): copies the new
// package.json version into the VERSION constant in src/pai.mts, so
// `pai --version`, the MCP server and the package agree.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf-8'));
const file = 'src/pai.mts';
const src = readFileSync(file, 'utf-8');
const next = src.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${version}';`);
if (next === src && !src.includes(`VERSION = '${version}'`)) {
  console.error('sync-version: VERSION constant not found in src/pai.mts');
  process.exit(1);
}
writeFileSync(file, next);
console.log(`sync-version: src/pai.mts is now ${version}`);
