#!/usr/bin/env node
/**
 * Layer 3 Stage A — one-shot Claude design phase for the categoriser
 * taxonomy cleanup. Reads the live taxonomy + every published piece
 * from prod D1 (read-only), makes ONE Claude call with the v1.1
 * categoriser contract injected, writes the proposed cleanup plan to
 * `scripts/categoriser-cleanup-plan.json` for operator review.
 *
 * **Zero D1 writes.** Every write happens later in Stage B
 * (`categoriser-cleanup-apply.mjs`), which reads the operator-edited
 * JSON and emits a forward-only migration. This script is safe to
 * re-run: regenerating the plan gives Claude a fresh look at the data
 * + contract; the operator can compare runs before applying.
 *
 * Usage (from a canonical checkout, NOT a worktree without
 * `node_modules`):
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/categoriser-cleanup-plan.mjs
 *
 * Requires `wrangler` on $PATH and Cloudflare auth in the standard
 * location (same wrangler the operator uses for `wrangler d1 execute
 * zeemish --remote ...`). Read-only against prod D1.
 *
 * Output shape (written to scripts/categoriser-cleanup-plan.json):
 *
 *   {
 *     "old_category_diagnosis": [
 *       { "slug": "knowledge-formation", "verdict": "process-level",
 *         "reason": "..." }
 *     ],
 *     "target_categories": [
 *       { "slug": "brain", "name": "Brain",
 *         "description": "Brain anatomy, neuroscience, ...",
 *         "from_old": ["knowledge-formation",
 *                      "neural-architecture-specialization"] }
 *     ],
 *     "piece_reassignments": [
 *       { "piece_id": "...", "headline": "...",
 *         "from": ["knowledge-formation"], "to": ["brain"],
 *         "reason": "..." }
 *     ],
 *     "disposition": [
 *       { "old_slug": "knowledge-formation",
 *         "action": "merge_into", "target": "brain" }
 *     ]
 *   }
 *
 * The categoriser-cleanup-plan FOLLOWUPS entry tracks the lifecycle
 * (in-progress → resolved on Stage B apply). See DECISIONS 2026-05-07
 * "Categoriser fragmentation fix — Layer 1+2" for the full architectural
 * context.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CONTRACT_PATH = join(REPO_ROOT, 'content', 'categoriser-contract.md');
const PLAN_OUT_PATH = join(__dirname, 'categoriser-cleanup-plan.json');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY env var is required.');
  process.exit(1);
}

/** Run a read-only D1 query against prod via wrangler and return the
 *  results array. Throws on non-zero exit or unexpected output. */
function d1Query(sql) {
  const result = spawnSync(
    'wrangler',
    ['d1', 'execute', 'zeemish', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    console.error('wrangler d1 execute failed:', result.stderr);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    console.error('Could not parse wrangler JSON output:', err.message);
    console.error('First 500 chars of stdout:', result.stdout.slice(0, 500));
    process.exit(3);
  }
  // wrangler --json wraps results in an array; we always run a single
  // SELECT so we want the first element's results.
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first || !Array.isArray(first.results)) {
    console.error('Unexpected wrangler output shape:', JSON.stringify(parsed).slice(0, 500));
    process.exit(4);
  }
  return first.results;
}

console.error('1/4 Reading contract...');
const contract = readFileSync(CONTRACT_PATH, 'utf8');

console.error('2/4 Reading pieces + categories from prod D1...');
const pieces = d1Query(
  `SELECT dp.id, dp.headline, dp.underlying_subject,
          GROUP_CONCAT(c.slug, '|') AS current_slugs
   FROM daily_pieces dp
   LEFT JOIN piece_categories pc ON pc.piece_id = dp.id
   LEFT JOIN categories c ON c.id = pc.category_id
   GROUP BY dp.id
   ORDER BY dp.published_at ASC`,
);
const categories = d1Query(
  `SELECT slug, name, piece_count, description
   FROM categories
   ORDER BY piece_count DESC, name ASC`,
);

console.error(`   ${pieces.length} pieces, ${categories.length} categories.`);

const piecesBlock = pieces
  .map((p) => {
    const cur = (p.current_slugs ?? '').split('|').filter(Boolean);
    return `- piece_id: ${p.id}
  headline: "${(p.headline ?? '').replace(/"/g, '\\"')}"
  underlying_subject: ${p.underlying_subject ?? '(none)'}
  current_categories: [${cur.join(', ')}]`;
  })
  .join('\n');

const categoriesBlock = categories
  .map(
    (c) => `- slug: ${c.slug}
  name: "${c.name}"
  piece_count: ${c.piece_count}
  description: ${c.description ?? '(no description)'}`,
  )
  .join('\n');

const userPrompt = `You are designing a one-shot cleanup of the Daylila library taxonomy. The current state is fragmented: ${categories.length} categories for ${pieces.length} pieces. Your job is to propose a coherent target taxonomy of roughly 10 categories (single-word names where possible) and a per-piece reassignment plan.

Apply the rules in the categoriser contract that follows. Pay special attention to the Category names section (single-word, two-word only when ambiguous, no \`&\` / \`and\` / 3+ words) and the Category descriptions section (domain-level, names the territory, not an intellectual move). The current taxonomy violates both rules — diagnose first, redesign second.

## The published pieces (${pieces.length})

${piecesBlock}

## The current categories (${categories.length})

${categoriesBlock}

## Output (strict JSON, no prose, no markdown fences)

Return ONE JSON object with this exact shape:

{
  "old_category_diagnosis": [
    {
      "slug": "<existing slug exactly as shown>",
      "verdict": "domain-level" | "process-level" | "topic-of-the-week",
      "reason": "one short sentence — why this verdict"
    }
  ],
  "target_categories": [
    {
      "slug": "kebab-case-slug",
      "name": "OneWord (or two-word only if one-word is ambiguous)",
      "description": "One sentence naming the DOMAIN — subjects, fields, phenomena.",
      "from_old": ["<existing slug>", "<existing slug>"]
    }
  ],
  "piece_reassignments": [
    {
      "piece_id": "<piece id exactly as shown>",
      "headline": "<piece headline for operator review>",
      "from": ["<existing slug>"],
      "to": ["<new target slug>"],
      "reason": "one short sentence — why this target"
    }
  ],
  "disposition": [
    {
      "old_slug": "<existing slug>",
      "action": "merge_into" | "rename_to" | "retire",
      "target": "<new target slug or new name; null if retire>"
    }
  ]
}

Rules for the redesign:
- Diagnose each existing category honestly. Most current names are process-level (e.g. \`Knowledge Formation\` describes how a piece thinks; \`Resource Constraints & Trade-offs\` describes a meta-pattern); rewrite to domain-level.
- Aim for roughly 10 target categories. Fewer if the corpus genuinely clusters tighter; more only if pieces would otherwise be force-fit.
- Each target category needs a fresh domain-level description, written from scratch based on the actual pieces being assigned to it. Do NOT paraphrase the old description.
- Every published piece must end up in 1–3 target categories.
- Reserve the \`patterns-yet-to-cluster\` slug as-is — do not include it in target_categories or assign pieces to it. (It's the locked operator-review fallback.)
- The \`from_old\` array on each target category lists the old slugs being merged into it — used by Stage B to generate the migration.
- The \`disposition\` array covers every old slug exactly once (\`merge_into\` if the pieces fold into a target; \`rename_to\` if the slug stays but gets renamed to a new target; \`retire\` only if zero pieces survive — should be rare).

## The categoriser contract (v1.1, the rules apply to this redesign too)

${contract}
`;

console.error('3/4 Calling Claude (Sonnet 4.5)...');
const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 16000,
    system:
      'You are designing a one-shot taxonomy cleanup for an autonomous publishing system. Apply the categoriser contract rigorously. Output strict JSON only — no prose outside the object, no markdown fences.',
    messages: [{ role: 'user', content: userPrompt }],
  }),
});

if (!claudeRes.ok) {
  console.error('Anthropic API error:', claudeRes.status, await claudeRes.text());
  process.exit(5);
}

const claudeJson = await claudeRes.json();
const text = claudeJson.content?.[0]?.text ?? '';
const inputTokens = claudeJson.usage?.input_tokens ?? 0;
const outputTokens = claudeJson.usage?.output_tokens ?? 0;

let plan;
try {
  // Strip leading/trailing markdown fences just in case Claude adds them
  // despite the strict instruction. The contract says no fences but a
  // tolerant parser is cheap insurance for a one-shot script.
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  plan = JSON.parse(cleaned);
} catch (err) {
  console.error('Could not parse Claude response as JSON:', err.message);
  console.error('First 500 chars of response:', text.slice(0, 500));
  process.exit(6);
}

writeFileSync(PLAN_OUT_PATH, JSON.stringify(plan, null, 2) + '\n', 'utf8');

const targetCount = Array.isArray(plan.target_categories) ? plan.target_categories.length : 0;
const reassignCount = Array.isArray(plan.piece_reassignments) ? plan.piece_reassignments.length : 0;

console.error(`4/4 Plan written to scripts/categoriser-cleanup-plan.json`);
console.error(`    ${categories.length} → ${targetCount} categories.`);
console.error(`    ${reassignCount} piece reassignments.`);
console.error(`    Tokens: ${inputTokens} in / ${outputTokens} out.`);
console.error('');
console.error('Next steps:');
console.error('  1. Open scripts/categoriser-cleanup-plan.json and review.');
console.error('     Edit names, descriptions, or per-piece reassignments inline.');
console.error('  2. Run: node scripts/categoriser-cleanup-apply.mjs');
console.error('     (generates migrations/0039_categoriser_cleanup.sql — does NOT execute it).');
console.error('  3. Review the generated SQL.');
console.error('  4. Apply: wrangler d1 migrations apply zeemish --remote');
