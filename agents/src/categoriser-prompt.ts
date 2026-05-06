/**
 * Categoriser prompts — assign 1–3 categories to a published daily
 * piece, strongly biased toward reusing an existing category.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * CategoriserAgent is the only caller.
 *
 * Rule body lives at `content/categoriser-contract.md`, codegenned
 * into `${CATEGORISER_CONTRACT}` and injected into the system prompt
 * below. The four named constants (max-assignments, reuse floor,
 * stretch floor, fallback slug) live at
 * `agents/src/shared/categoriser-thresholds.ts` and are re-exported
 * here for back-compat with existing call-sites. Foundation Fix
 * Task 02 eighth (and final) extraction session, 2026-05-10.
 */

import { CATEGORISER_CONTRACT } from './shared/generated/contracts';

export {
  CATEGORISER_MAX_ASSIGNMENTS,
  CATEGORISER_REUSE_CONFIDENCE_FLOOR,
  CATEGORISER_REUSE_CONFIDENCE_STRETCH,
  CATEGORISER_FALLBACK_SLUG,
} from './shared/categoriser-thresholds';

export const CATEGORISER_PROMPT = `You categorise a just-published Daylila daily piece by assigning it to 1–3 categories. Every piece MUST land in at least one category — returning an empty assignments array is never a valid answer.

You are shown:
- The piece's headline, underlying subject, and the first chunk of its body.
- The full list of categories that already exist in the library, with their descriptions and current piece counts.

Your only output is the JSON described at the bottom. Do not write prose outside the object.

${CATEGORISER_CONTRACT}

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
 *
 * The literal `60` and `74` here are kept in sync by hand with
 * `content/categoriser-contract.md` — codegen JSON.stringify's the
 * markdown verbatim, so template-literal interpolations in this
 * string would never reach Claude. Same posture as fact-check's
 * `max_uses = 8` retry context.
 */
export const CATEGORISER_RETRY_MESSAGE = `Your previous response was an empty assignments array (or only contained existing-category assignments below the 60 confidence floor). That violates the contract — every piece MUST land in at least one category.

Re-evaluate using the tiered decision. The most likely correct path here is one of:
- **Stretch reuse**: pick the closest existing category at 60–74 confidence, with a reasoning sentence that names what's stretchy.
- **New category**: propose ONE durable new category that captures the piece's primary underlying subject.

Return at least 1 assignment now. Same JSON shape as before.`;
