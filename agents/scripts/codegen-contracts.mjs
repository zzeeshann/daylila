#!/usr/bin/env node
// Build-time codegen for agent prompt contracts.
//
// Why this exists: Cloudflare Workers (where the agents run as
// Durable Objects) cannot fs.readFileSync at runtime. Prompt content
// must be embedded in the TypeScript bundle at build time. Until
// 2026-05-03 the agents project carried two manual `.ts` mirrors of
// content under `content/` and `docs/examples/` — both had silently
// drifted from canonical (the voice mirror stripped markdown bold,
// the html mirror lost a CSS block). This script removes the manual
// step: it reads the canonical sources and writes a generated TS
// module the agents bundle imports.
//
// The generated file is checked in (the codebase's audit trail is
// `git log` + `git diff`; staleness is caught by
// `verify-contracts-fresh.mjs` in CI before deploy).
//
// Embedding strategy: JSON.stringify the raw file bytes. Robust
// against backticks, ${...}, unicode dashes, no escape ceremony.
// Template literals are unsafe — the html reference contains both
// backticks and ${} patterns inside <script> blocks.
//
// Usage:
//   node agents/scripts/codegen-contracts.mjs        # writes the file
//   import { buildContractsTs } from './codegen-contracts.mjs'  # used by verifier
//
// Wrangler hook: `[build] command = "node scripts/codegen-contracts.mjs"`
// in agents/wrangler.toml runs this automatically before every
// `wrangler dev` and `wrangler deploy`.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Canonical sources (paths relative to this script) ───────────
const SOURCES = [
  {
    name: 'VOICE_CONTRACT',
    path: '../../content/voice-contract.md',
    label: 'content/voice-contract.md',
  },
  {
    name: 'INTERACTIVE_HTML_REFERENCE',
    path: '../../docs/examples/interactive-reference.html',
    label: 'docs/examples/interactive-reference.html',
  },
  {
    name: 'BEAT_CONTRACT',
    path: '../../content/beat-contract.md',
    label: 'content/beat-contract.md',
  },
  {
    name: 'INTERACTIVE_CONTRACT',
    path: '../../content/interactive-contract.md',
    label: 'content/interactive-contract.md',
  },
  {
    name: 'AUDIT_CONTRACT',
    path: '../../content/audit-contract.md',
    label: 'content/audit-contract.md',
  },
  {
    name: 'FACT_CHECK_CONTRACT',
    path: '../../content/fact-check-contract.md',
    label: 'content/fact-check-contract.md',
  },
  {
    name: 'CURATOR_CONTRACT',
    path: '../../content/curator-contract.md',
    label: 'content/curator-contract.md',
  },
  {
    name: 'AUDIO_CONTRACT',
    path: '../../content/audio-contract.md',
    label: 'content/audio-contract.md',
  },
  {
    name: 'CATEGORISER_CONTRACT',
    path: '../../content/categoriser-contract.md',
    label: 'content/categoriser-contract.md',
  },
  {
    name: 'INTEGRATOR_CONTRACT',
    path: '../../content/integrator-contract.md',
    label: 'content/integrator-contract.md',
  },
];

const OUTPUT_PATH = resolve(__dirname, '../src/shared/generated/contracts.ts');

const HEADER = `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: agents/scripts/codegen-contracts.mjs
// Inputs:
${SOURCES.map((s) => `//   ${s.label}`).join('\n')}
// Regenerate: cd agents && pnpm codegen
// Verify freshness: cd agents && pnpm verify-contracts-fresh
`;

/**
 * Read every canonical source and produce the full TypeScript file
 * body as a string. Pure — no filesystem writes. The verifier reuses
 * this function to compare against the on-disk file.
 */
export function buildContractsTs() {
  const blocks = SOURCES.map(({ name, path }) => {
    const abs = resolve(__dirname, path);
    const text = readFileSync(abs, 'utf8');
    return `export const ${name} = ${JSON.stringify(text)};\n`;
  });
  return `${HEADER}\n${blocks.join('\n')}`;
}

/**
 * Build-time assertion: PickDomain enum in agents/src/types.ts matches
 * the bullet list under "Pick domain enum" in
 * content/curator-contract.md. Fails build if drift detected.
 *
 * Per Zi's PR #1 directive (2026-05-09): "Worth a quick assertion in
 * the codegen step that the enum values still match the contract list,
 * so the two stay locked." This is a developer-build consistency check
 * between two intentionally-mirrored sources, not contract-rule
 * enforcement in code (which would violate the rule from
 * docs/SESSION_OPENER.md).
 *
 * Both sources include `unknown` in the TS enum as a forward-compat
 * sentinel not appearing in the contract bullet list — the assertion
 * compares against the 10 real domain slugs only.
 */
function assertPickDomainEnumMatchesContract() {
  const CONTRACT = readFileSync(
    resolve(__dirname, '../../content/curator-contract.md'),
    'utf8',
  );
  const TYPES = readFileSync(
    resolve(__dirname, '../src/types.ts'),
    'utf8',
  );

  // Parse contract: lines starting with `- \`<slug>\`` under the Pick
  // domain enum section. Heading depth is flexible (## or ###) — the
  // contract chooses; the parser doesn't care. Stop at the next
  // heading of equal-or-shallower depth.
  const sectionMatch = CONTRACT.match(/^(#{2,3})\s+Pick domain enum\s*$/m);
  if (!sectionMatch) {
    throw new Error('codegen-contracts assertion: "Pick domain enum" section heading missing from curator-contract.md');
  }
  const sectionStart = sectionMatch.index;
  const headingDepth = sectionMatch[1].length;
  const sectionAfter = CONTRACT.slice(sectionStart + sectionMatch[0].length);
  // Match the next heading at the same depth or shallower.
  const stopPattern = new RegExp(`\\n#{2,${headingDepth}} `, 'm');
  const sectionEnd = sectionAfter.search(stopPattern);
  const section = sectionEnd === -1 ? sectionAfter : sectionAfter.slice(0, sectionEnd);
  const contractSlugs = [...section.matchAll(/^- `([a-z][a-z0-9-]*)`/gm)].map((m) => m[1]);

  // Parse types.ts: lines like `  | 'inner-life'` inside `export type PickDomain`.
  const typeStart = TYPES.indexOf('export type PickDomain');
  if (typeStart === -1) {
    throw new Error('codegen-contracts assertion: PickDomain type missing from agents/src/types.ts');
  }
  const typeBody = TYPES.slice(typeStart, TYPES.indexOf(';', typeStart));
  const tsSlugs = [...typeBody.matchAll(/'([a-z][a-z0-9-]*)'/g)]
    .map((m) => m[1])
    .filter((s) => s !== 'unknown');

  const contractSorted = [...contractSlugs].sort();
  const tsSorted = [...tsSlugs].sort();
  if (contractSorted.length !== tsSorted.length || contractSorted.some((v, i) => v !== tsSorted[i])) {
    throw new Error(
      `codegen-contracts assertion FAILED: PickDomain enum drift.
  contract (curator-contract.md): ${JSON.stringify(contractSorted)}
  types.ts (agents/src/types.ts):  ${JSON.stringify(tsSorted)}
Edit one to match the other before continuing.`,
    );
  }
  if (contractSlugs.length !== 10) {
    throw new Error(
      `codegen-contracts assertion: expected exactly 10 domain slugs in contract, found ${contractSlugs.length}: ${JSON.stringify(contractSlugs)}`,
    );
  }
}

function main() {
  assertPickDomainEnumMatchesContract();
  const body = buildContractsTs();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, body, 'utf8');
  console.log(`codegen-contracts: wrote ${OUTPUT_PATH} (${body.length} bytes)`);
}

// Only run main when invoked directly, not when imported by the verifier.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
