#!/usr/bin/env node
// Eyeball verification of the new doctrine-aware Drafter prompt.
//
// Reads ANTHROPIC_API_KEY from .dev.vars (or env), reconstructs a
// brief from a recent published piece's frontmatter, and runs the
// new Drafter system prompt + buildDrafterPrompt against it. Prints
// the resulting MDX so a human can compare the writing posture
// against the actually-shipped piece.
//
// Usage:
//   cd agents
//   node scripts/verify-doctrine.mjs
//
// Cost: one Claude Sonnet 4.5 call, ~5–8k input tokens + ~2k output
// tokens, ≈ $0.05 per run.
//
// What to look for in the output:
//   - Hook: drops the reader into something already happening, no "today
//     we look at" / "imagine a world where" / summary-then-question.
//   - Specific anchor in teaching beats: a person, a number, a moment.
//   - Close: one sentence. Just sits. No moral.
//   - Absence of "this matters because" / "the lesson here" / "complex"
//     as hand-wave / passive voice that hides who acted.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

// Read API key from .dev.vars or env.
let apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  try {
    const devVars = readFileSync(resolve(repoRoot, '.dev.vars'), 'utf8');
    const m = devVars.match(/ANTHROPIC_API_KEY\s*=\s*"?([^"\n\r]+)"?/);
    if (m) apiKey = m[1].trim();
  } catch {
    // fall through
  }
}
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY not found in env or .dev.vars');
  process.exit(1);
}

// Read the new prompts from source. Tiny TS-as-text parse — we extract
// the constant body between backticks rather than dragging in tsc.
function extractTemplateLiteral(tsSource, exportName) {
  const re = new RegExp(
    `export\\s+const\\s+${exportName}\\s*(?::[^=]+)?=\\s*\`([\\s\\S]*?)\`;`,
  );
  const m = tsSource.match(re);
  if (!m) throw new Error(`Could not extract ${exportName}`);
  return m[1];
}

const drafterPromptSrc = readFileSync(
  resolve(repoRoot, 'agents/src/drafter-prompt.ts'),
  'utf8',
);
const voiceContractSrc = readFileSync(
  resolve(repoRoot, 'agents/src/shared/voice-contract.ts'),
  'utf8',
);
const voiceDoctrineSrc = readFileSync(
  resolve(repoRoot, 'agents/src/shared/voice-doctrine.ts'),
  'utf8',
);

const VOICE_DOCTRINE = extractTemplateLiteral(voiceDoctrineSrc, 'VOICE_DOCTRINE');
const VOICE_CONTRACT = extractTemplateLiteral(voiceContractSrc, 'VOICE_CONTRACT');
const DRAFTER_PROMPT_RAW = extractTemplateLiteral(drafterPromptSrc, 'DRAFTER_PROMPT');
// DRAFTER_PROMPT references ${VOICE_DOCTRINE} via template-literal interp.
// Since we extracted it as raw text, interpolate manually.
const DRAFTER_PROMPT = DRAFTER_PROMPT_RAW.replace('${VOICE_DOCTRINE}', VOICE_DOCTRINE);

// Reconstructed brief shaped like one Curator would produce for the
// 2026-04-26 cartel-gold piece. The shipped piece's frontmatter +
// beat names give us most of this; the toneNote / avoid / hooks are
// guesses at what a Curator would have written.
const brief = {
  date: '2026-04-26',
  headline: 'U.S. Mint Buys Drug Cartel Gold and Sells It as American',
  newsSource: 'The New York Times',
  underlyingSubject: 'Supply chain integrity and verification systems',
  teachingAngle:
    'Supply chains inherit the identity of their inputs. When verification fails upstream, contamination becomes invisible downstream — and the system\'s self-image stays clean.',
  estimatedTime: '7 minutes',
  toneNote:
    'Arrival, not framing. The system is already running. Show a refinery accepting ore. Show a Mint stamp coming down. Don\'t explain the metaphor of "supply chains inheriting identity" — show identity being lost in the melt.',
  avoid:
    'Resolving the contradiction. The cartel-gold story tempts a tidy moral about regulation or transparency; the system is structurally unable to know what it\'s buying, and that\'s the teaching, not a problem to be solved.',
  hooks: [
    'A press at the U.S. Mint stamps "American" onto a one-ounce gold bar. Yesterday it was molten. The day before it was a different shape, in a different country.',
    'Gold loses its identity when it gets melted. That fact is not a bug.',
    'The paperwork says the gold is clean by the time it reaches the Mint.',
  ],
  beats: [
    {
      name: 'hook',
      type: 'hook',
      description:
        'Drop the reader at the moment the Mint stamp comes down on a bar whose origin is already untraceable. Then the question that opens the teaching.',
    },
    {
      name: 'how-it-happened',
      type: 'teaching',
      description:
        'A refinery is a fact-erasing machine. Walk through what it does to ore — chemical purification, blending across sources, output as standardised bars. The melt is where origin dies.',
    },
    {
      name: 'why-hard',
      type: 'teaching',
      description:
        'Verification fails upstream because the actors closest to the source are the ones who profit from ambiguity. Each downstream actor relies on the paperwork from the one above.',
    },
    {
      name: 'the-pattern',
      type: 'teaching',
      description:
        'Generalise: this isn\'t about gold. Show the same shape in another supply chain — coffee, palm oil, semiconductor minerals — without naming the cartel-gold case. The pattern is the teaching.',
    },
    {
      name: 'what-works',
      type: 'teaching',
      description:
        'The structural fix is not better paperwork. Name what actually changes integrity — physical separation of supply lanes, single-origin certification, or verifying at the chemistry level instead of the document level.',
    },
    {
      name: 'close',
      type: 'close',
      description:
        'One sentence. The Mint stamp coming down. Or the bar in the vault. The last true thing about a system that cannot, by design, know what it owns.',
    },
  ],
};

// Inline copy of buildDrafterPrompt (mirroring agents/src/drafter-prompt.ts).
function buildDrafterPrompt(brief, voiceContract, learnings = []) {
  const lessonsBlock =
    learnings.length === 0
      ? ''
      : `## Lessons from prior pieces\n${learnings
          .map((l) => `- [${l.category}] ${l.observation}`)
          .join('\n')}\n\n`;

  return `## Operational voice contract
${voiceContract}

${lessonsBlock}## Today's Brief
Date: ${brief.date}
News: "${brief.headline}" (${brief.newsSource})
Underlying subject: ${brief.underlyingSubject}
Teaching angle: ${brief.teachingAngle}
Tone note: ${brief.toneNote}
Avoid: ${brief.avoid}

## Candidate hooks
${brief.hooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}

## Beat plan
${brief.beats.map((b) => `- ${b.name} (${b.type}): ${b.description}`).join('\n')}

Write the piece.`;
}

const userMessage = buildDrafterPrompt(brief, VOICE_CONTRACT, []);

console.log('--- SYSTEM PROMPT (head) ---');
console.log(DRAFTER_PROMPT.slice(0, 600));
console.log('...');
console.log(`(system prompt length: ${DRAFTER_PROMPT.length} chars)`);
console.log();
console.log('--- USER MESSAGE ---');
console.log(userMessage);
console.log();
console.log('--- CALLING CLAUDE ---');
console.log();

const start = Date.now();
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000,
    system: DRAFTER_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  }),
});

if (!response.ok) {
  console.error(`HTTP ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

const body = await response.json();
const text = body.content?.[0]?.type === 'text' ? body.content[0].text : '';
const elapsed = Date.now() - start;

console.log('--- DRAFTER OUTPUT ---');
console.log();
console.log(text);
console.log();
console.log('--- METADATA ---');
console.log(`Latency: ${elapsed}ms`);
console.log(`Input tokens: ${body.usage?.input_tokens}`);
console.log(`Output tokens: ${body.usage?.output_tokens}`);
console.log(`Approximate cost: $${(
  ((body.usage?.input_tokens ?? 0) * 3 +
    (body.usage?.output_tokens ?? 0) * 15) / 1_000_000
).toFixed(4)}`);
