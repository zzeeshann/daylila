#!/usr/bin/env node
// Drift gate for the codegenned contracts file.
//
// Background: agents/src/shared/generated/contracts.ts is produced
// by agents/scripts/codegen-contracts.mjs from canonical sources
// (`content/voice-contract.md`, `docs/examples/interactive-reference.html`).
// The file is checked in so the diff is auditable; this verifier
// catches the case where someone edited a canonical source but
// forgot to re-run codegen and commit the regenerated TS.
//
// CI runs this in `.github/workflows/deploy-site.yml` (check-agents
// job) before the deploy-agents job. A stale committed file blocks
// deploy.
//
// Usage:  cd agents && pnpm verify-contracts-fresh
// Exit code: 0 on fresh, 1 on stale.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContractsTs } from './codegen-contracts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_PATH = resolve(__dirname, '../src/shared/generated/contracts.ts');

const expected = buildContractsTs();
let actual;
try {
  actual = readFileSync(OUTPUT_PATH, 'utf8');
} catch (err) {
  console.error(`✗ Generated file missing: ${OUTPUT_PATH}`);
  console.error(`  ${err.message}`);
  console.error('\nRun: cd agents && pnpm codegen && git add agents/src/shared/generated/contracts.ts');
  process.exit(1);
}

if (actual === expected) {
  console.log(`✓ ${OUTPUT_PATH} is fresh (${actual.length} bytes)`);
  process.exit(0);
}

// Stale — show the operator where it differs.
console.error(`✗ ${OUTPUT_PATH} is stale.\n`);
console.error(`Expected ${expected.length} bytes, found ${actual.length} bytes.\n`);

const expectedLines = expected.split('\n');
const actualLines = actual.split('\n');
const max = Math.max(expectedLines.length, actualLines.length);
let shown = 0;
const LIMIT = 20;
for (let i = 0; i < max && shown < LIMIT; i += 1) {
  const e = expectedLines[i];
  const a = actualLines[i];
  if (e !== a) {
    console.error(`  L${i + 1} expected: ${e === undefined ? '<eof>' : JSON.stringify(e)}`);
    console.error(`  L${i + 1}   actual: ${a === undefined ? '<eof>' : JSON.stringify(a)}`);
    shown += 1;
  }
}
if (shown === LIMIT) {
  console.error(`  … (more diffs suppressed; showed first ${LIMIT})`);
}

console.error('\nRun: cd agents && pnpm codegen && git add agents/src/shared/generated/contracts.ts');
process.exit(1);
