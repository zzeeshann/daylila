/**
 * Categoriser prompts — assign 1–3 categories to a published daily
 * piece, strongly biased toward reusing an existing category.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * CategoriserAgent is the only caller.
 */

/** Hard cap on assignments per piece. The prompt enforces 1–3; this
 *  constant is re-used by the agent when it clamps the LLM's output
 *  so a misbehaving response can't over-tag a piece. */
export const CATEGORISER_MAX_ASSIGNMENTS = 3;

/** Ideal reuse floor — confidence at which an existing category is a
 *  clean fit for the piece's *primary* underlying subject. At or above
 *  this, reuse is the obvious answer. Raised 60 → 75 on 2026-04-25
 *  after the firing-squads piece picked up "Commodity Shocks" at 70
 *  confidence (a cross-domain stretch from "supply running out" to
 *  "commodity shock"). See DECISIONS 2026-04-25. */
export const CATEGORISER_REUSE_CONFIDENCE_FLOOR = 75;

/** Stretch reuse floor — when no existing category fits at ≥75 AND
 *  the piece isn't novel enough to justify a new category, the prompt
 *  instructs Claude to reuse the closest existing at ≥60 with explicit
 *  reasoning that names what's stretchy. Below this, an existing-cat
 *  assignment is too thin to write — code filters and triggers the
 *  retry-then-fallback path. Added 2026-04-29 as part of the
 *  zero-assignment fix. */
export const CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60;

/** Reserved slug for the system fallback category seeded in migration
 *  0024. Used ONLY when both Claude attempts return zero assignments.
 *  Hidden from the public library chip bar AND filtered from the
 *  Categoriser context list (Claude must never see it as a "reuse
 *  target" — would defeat the retry layer's purpose). */
export const CATEGORISER_FALLBACK_SLUG = 'patterns-yet-to-cluster';

export const CATEGORISER_PROMPT = `You categorise a just-published Zeemish daily piece by assigning it to 1–3 categories. Every piece MUST land in at least one category — returning an empty assignments array is never a valid answer.

You are shown:
- The piece's headline, underlying subject, and the first chunk of its body.
- The full list of categories that already exist in the library, with their descriptions and current piece counts.

Your only output is the JSON described at the bottom. Do not write prose outside the object.

# Hard rule: at least one assignment

Every piece must land in at least one category. If you finish reviewing the existing list and feel none fits cleanly, that's not a reason to return zero — it's a reason to follow the tiered decision below. The empty-array answer doesn't exist.

# The most important rule: prefer reuse over novelty

Categories are a taxonomy for readers to browse the library. They only work if they mean something specific. A taxonomy that grows a new category for every piece becomes noise — it's a list of headlines, not a map.

Strongly prefer reusing an existing category. Before proposing a new one, ask yourself:
- Is there an existing category whose description covers this piece's *underlying subject*, even if the headline is new?
- Could this piece plausibly sit alongside pieces already in one of the existing categories? (Check the piece counts — a category with 6 pieces has a defined shape; a category with 1 piece hasn't converged yet.)
- Am I proposing a new category because the piece is genuinely different, or because the headline uses a different word than the existing category names?

If you're on the fence between reuse and novel, reuse.

# Tiered decision (apply in order — never return zero)

1. **Ideal reuse (confidence ≥${CATEGORISER_REUSE_CONFIDENCE_FLOOR}).** An existing category's description clearly covers this piece's primary underlying subject. Pick it. You may add a second one if the piece genuinely spans (≥${CATEGORISER_REUSE_CONFIDENCE_FLOOR} on the second too).

2. **Stretch reuse (confidence ${CATEGORISER_REUSE_CONFIDENCE_STRETCH}–${CATEGORISER_REUSE_CONFIDENCE_FLOOR - 1}).** No existing category fits cleanly, but one is the closest match AND the piece's underlying subject isn't different enough from the existing taxonomy to warrant a brand-new category. Reuse the closest existing — your reasoning sentence MUST name what makes the fit stretchy (e.g. "thematic echo, not primary subject" / "adjacent mechanism, not core"). This keeps the taxonomy converging rather than fragmenting.

3. **New category (only if neither tier applies).** The piece's underlying subject is materially absent from the existing list — no existing category fits even at ${CATEGORISER_REUSE_CONFIDENCE_STRETCH}. Propose ONE new category. A good new category:
   - Is a *subject*, not a topic-of-the-week (e.g. "Chokepoints & Supply", not "Suez Canal").
   - Could plausibly hold 10+ future pieces (e.g. "Monetary Policy", not "This Week's Fed Meeting").
   - Has a one-sentence description that would help another piece's categoriser know whether to put it here.
   - Has a kebab-case slug derived from the name (e.g. "chokepoints-and-supply"). Keep it short — under 4 words in the name.

Return AT MOST one new category per piece. If two aspects of the piece feel novel, pick the more important one and reuse-or-stretch-reuse the other.

# Assignment shape

Return between 1 and ${CATEGORISER_MAX_ASSIGNMENTS} assignments. More than one is fine when a piece genuinely spans — e.g. a monetary-policy piece that also teaches supply chains could legitimately land in both. Don't pad. Three is an upper bound, not a target.

For each assignment, provide a confidence (0–100). For existing-category assignments, confidence reflects how well the piece fits that category's stated scope. For a new category, confidence reflects how confidently you believe it's a durable addition to the taxonomy. Existing-category assignments below ${CATEGORISER_REUSE_CONFIDENCE_STRETCH} confidence will be rejected by the writer — don't return them; either find a better existing fit or propose a new category.

# Response format (strict)

Return JSON with this exact shape. One of \`categoryId\` or \`newCategory\` must be present on each assignment, never both:

{
  "assignments": [
    {
      "categoryId": "<existing category UUID, exactly as shown>",
      "confidence": 85,
      "reasoning": "one short sentence — why this piece fits this category"
    },
    {
      "newCategory": {
        "name": "Short Display Name",
        "slug": "kebab-case-slug",
        "description": "One sentence about what belongs in this category."
      },
      "confidence": 80,
      "reasoning": "one short sentence — why no existing category fits and this one would be durable"
    }
  ]
}

No prose. No markdown fences. No explanation outside the object.
`;

/** Shape of one existing category as fed into the prompt's context. */
export interface CategoryContextRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pieceCount: number;
}

/** Shape of the piece context fed into the prompt. */
export interface PieceContext {
  headline: string;
  underlyingSubject: string | null;
  bodyExcerpt: string;
}

/**
 * Build the user-message context for Categoriser. Keeps the piece
 * excerpt bounded (~2000 chars of body after frontmatter strip) so
 * the call cost stays predictable across a session of backfills.
 */
export function buildCategoriserPrompt(
  piece: PieceContext,
  existing: CategoryContextRow[],
): string {
  const pieceBlock = `## The piece
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}

### Body excerpt (first ~2000 chars, frontmatter stripped)
${piece.bodyExcerpt}`;

  const categoriesBlock = existing.length === 0
    ? `## Existing categories
(None yet — this is the first piece being categorised. Propose ONE new category that captures this piece's underlying subject as a durable, reusable taxonomy node. Returning zero assignments is not allowed.)`
    : `## Existing categories (${existing.length} total — prefer one of these)
${existing
        .map(
          (c) => `- id: ${c.id}
  name: "${c.name}"
  slug: ${c.slug}
  description: ${c.description ?? '(no description)'}
  piece_count: ${c.pieceCount}`,
        )
        .join('\n')}`;

  return `${pieceBlock}\n\n${categoriesBlock}`;
}

/**
 * Retry message sent as a follow-up `user` turn after Claude returns
 * an empty `assignments` array on the first attempt. Keeps the
 * original prompt + first response in the conversation so Claude has
 * full context for the second attempt; the retry message just names
 * the violation and pushes toward the stretch-reuse tier.
 */
export const CATEGORISER_RETRY_MESSAGE = `Your previous response was an empty assignments array (or only contained existing-category assignments below the ${CATEGORISER_REUSE_CONFIDENCE_STRETCH} confidence floor). That violates the contract — every piece MUST land in at least one category.

Re-evaluate using the tiered decision. The most likely correct path here is one of:
- **Stretch reuse**: pick the closest existing category at ${CATEGORISER_REUSE_CONFIDENCE_STRETCH}–${CATEGORISER_REUSE_CONFIDENCE_FLOOR - 1} confidence, with a reasoning sentence that names what's stretchy.
- **New category**: propose ONE durable new category that captures the piece's primary underlying subject.

Return at least 1 assignment now. Same JSON shape as before.`;
