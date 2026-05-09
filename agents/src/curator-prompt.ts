/**
 * Curator prompt — owns story selection + beat planning.
 *
 * Migrated from shared/prompts.ts (DAILY_DIRECTOR_PROMPT) in PR 2.
 * Director no longer owns this prompt. Curator is the only caller.
 *
 * Foundation Fix Task 02 (2026-05-08): rule body extracted to
 * `content/curator-contract.md` and injected via `${CURATOR_CONTRACT}`.
 * The opener + Daylila Protocol three-sentence framing stay inline as
 * system-prompt scaffolding (voice-contract.md is the Protocol's
 * canonical home). Response-format JSON spec + verbatim-UUID rule stay
 * inline below the injection — response-shape spec, not rule body
 * (same posture as fact-check Q5 / audit Q5 / beats Q6). User-message
 * data blocks stay; rule prose collapses to a Tier-2 audit-context
 * paraphrase under the data (beats Q6 precedent).
 */

import type { DailyCandidate } from './types';
import { CURATOR_CONTRACT } from './shared/generated/contracts';

export const CURATOR_PROMPT = `You are the Curator of Daylila.

## The Daylila Protocol

"Educate myself for humble decisions."

"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."

Everything that follows is an attempt to show you what that means — and how to do it.

${CURATOR_CONTRACT}

## Output

Return JSON:
{
  "selectedCandidateId": "<uuid copied verbatim from the chosen candidate's id: field — e.g. 0f3a8b6c-2d1e-4f9a-b7c8-1e2d3f4a5b6c>",
  "pickReasoning": "<1-3 sentences explaining why this candidate is the most teachable today — see 'What to record' in the contract>",
  "pickDomain": "<one of: inner-life | meaning | expression | language | science | body | how-humans-live | skills | technology | time-and-place — the teachability-taxonomy domain whose lens does the most teaching work for this pick. Same names as the bullet list under 'TEACHABILITY' in the contract above. Pick the SUBJECT-of-the-teaching domain, not the surface category of the news (a Taylor Swift tour-economics piece is 'expression' or 'how-humans-live', not 'business' just because it's about money).>",
  "date": "YYYY-MM-DD",
  "headline": "the news headline",
  "newsSource": "source name",
  "underlyingSubject": "what this really teaches about",
  "teachingAngle": "what to teach and why it matters",
  "estimatedTime": "10 min",
  "toneNote": "guidance for the Drafter",
  "avoid": "what not to do",
  "hooks": ["hook 1", "hook 2", "hook 3"],
  "beats": [
    { "name": "hook", "type": "hook", "description": "..." },
    { "name": "teaching-1", "type": "teaching", "description": "..." },
    { "name": "teaching-2", "type": "teaching", "description": "..." },
    { "name": "teaching-3", "type": "teaching", "description": "..." },
    { "name": "teaching-4", "type": "teaching", "description": "..." },
    { "name": "close", "type": "close", "description": "..." }
    // 6-8 beats per piece per the beat contract (5-8 acceptable, 9+ padding).
    // Hook + close + 4-6 teaching beats. Add more teaching beats up to 6 if
    // the underlying system has multiple distinct moves to teach; collapse
    // to fewer if the principle lands with less.
  ],
  "rejections": [
    { "id": "<uuid copied verbatim from the candidate's id: field>", "rejectionCategory": "<one of the 8 enum values from the contract>", "rejectionReason": "<one sentence — only on the TOP 10 candidates you weighed most seriously; omit on the rest>" }
    // ... one entry per non-picked candidate. The id MUST be the exact UUID
    // shown in the candidate list — do not invent, truncate, guess, or
    // substitute a list position. Same verbatim-UUID rule as
    // selectedCandidateId. rejectionReason is OPTIONAL — present on the
    // top 10 only (was 5; raised 2026-05-09 to give the operator a
    // fuller audit trail of the candidates Curator actually weighed).
  ]
}

The "rejections" array must cover EVERY candidate in the input list except the picked one. The "rejectionCategory" field on each entry MUST be one of the 8 values defined in the "Rejection category enum" section of the contract above — do not invent new categories.

ONLY if the narrow skip conditions in the contract above genuinely apply, return the skip JSON named in "The skip output shape" — and remember: the reason must NAME the specific condition, never a category dismissal. The skip path produces no candidate-record (no rejections array), since there is no pick to weigh against.`;

export function buildCuratorPrompt(
  candidates: DailyCandidate[],
  recentPieces: Array<{ headline: string; underlyingSubject: string }>,
  recentCategoryCounts: Array<{ name: string; count: number }> = [],
  recentDomainCounts: Array<{ domain: string; count: number }> = [],
): string {
  const recentBlock = recentPieces.length > 0
    ? recentPieces
        .map((p) => `- "${p.headline}"\n  Underlying subject: ${p.underlyingSubject}`)
        .join('\n\n')
    : 'None yet.';
  // Soft-preference signal — Curator already has hard SAME-EVENT and
  // SAME-CONCEPT skip rules in the contract. This adds the missing
  // memory layer: category concentration over the last 30 days. Verbatim
  // from prod D1 sums via Director.getRecentCategoryCounts(30); excludes
  // the hidden patterns-yet-to-cluster fallback. Rule body for what to
  // do with the data lives in content/curator-contract.md.
  const categoryBlock = recentCategoryCounts.length > 0
    ? recentCategoryCounts
        .map((c) => `- ${c.name}: ${c.count} ${c.count === 1 ? 'piece' : 'pieces'}`)
        .join('\n')
    : 'None yet.';
  // Domain concentration — Curator's self-classification pick_domain
  // (PR #1, 2026-05-09). Distinct from category concentration above:
  // CATEGORY = library taxonomy assigned post-publish by CategoriserAgent
  // (Science / Governance / Trade / etc.); DOMAIN = the 10-domain
  // teachability taxonomy from the Curator contract (inner-life / meaning
  // / expression / etc.) classified by Curator itself at pick time.
  // The domain signal lets Curator notice "9 hard-science picks in 30 days
  // and 0 expression picks" — exactly the pattern that the upstream feed
  // expansion of 2026-05-01 produced.
  const domainBlock = recentDomainCounts.length > 0
    ? recentDomainCounts
        .map((d) => `- ${d.domain}: ${d.count} ${d.count === 1 ? 'piece' : 'pieces'}`)
        .join('\n')
    : 'None yet.';
  return `## Today's news candidates:
${candidates.map((c) => `id: ${c.id}\n   [${c.category}] "${c.headline}" (${c.source})\n   ${c.summary}`).join('\n\n')}

## Already published recently (last 30 days)
${recentBlock}

Apply the SAME-EVENT and SAME-CONCEPT hard-skip rules from your system prompt against this list. Includes today's earlier picks if any.

## Recent category concentration (last 30 days)
${categoryBlock}

Apply the recent-category soft preference from your system prompt against this distribution.

## Recent domain concentration (last 30 days)
${domainBlock}

Apply the recent-domain soft preference from your system prompt against this distribution. The 10-domain taxonomy is breadth-showing — if 3+ recent picks have landed in one domain (e.g. science) and another domain (e.g. expression / skills / how-humans-live) sits at zero, prefer a candidate whose teaching lens lands in the thinner domain — unless the news event genuinely demands the fuller one.

Pick the most teachable story and create a brief. Two pieces about the same news event or teaching the same concept on the same day is a failure state.

Return JSON only. The "selectedCandidateId" field MUST be the exact UUID copied verbatim from the chosen candidate's "id:" field above — do not invent, truncate, guess, or substitute a list position number. The "pickDomain" field MUST be one of the 10 enum values listed in the system prompt — do not invent new domains.`;
}
