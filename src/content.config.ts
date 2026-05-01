import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Daily pieces collection — the primary content unit.
 * Lives in content/daily-pieces/
 * Filename format: YYYY-MM-DD-{slug}.mdx
 */
const dailyPieces = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './content/daily-pieces' }),
  schema: z.object({
    title: z.string(),
    date: z.string().or(z.date().transform((d) => d.toISOString().slice(0, 10))),
    // Unix-ms timestamp, spliced into frontmatter by Director at publish
    // time (analogous to voiceScore). Primary role: homepage + library
    // tiebreaker at multi-per-day cadence, where multiple pieces share
    // `date` — sort by publishedAt DESC gives a deterministic newest-
    // first order. Added in cadence Phase 4 (2026-04-21).
    publishedAt: z.number(),
    // UUID matching `daily_pieces.id` in D1. Spliced by Director at
    // publish time. Lets per-piece consumers (made-drawer fetch + API
    // learnings filter) resolve a piece by id without a date-based
    // lookup that would pool at multi-per-day. Added in Phase 7
    // writeLearning piece_id extension (2026-04-22).
    pieceId: z.string(),
    newsSource: z.string().optional(),
    underlyingSubject: z.string().optional(),
    estimatedTime: z.coerce.string(),
    beatCount: z.number(),
    description: z.string(),
    audioSrc: z.string().optional(),
    // Per-beat audio map: { beatName: publicUrl }. Spliced in by
    // Publisher.publishAudio (second commit) after AudioProducer +
    // AudioAuditor succeed. Missing on pieces whose audio hasn't landed
    // yet (text-first ship-and-retry) and on legacy pre-un-pause pieces.
    audioBeats: z.record(z.string(), z.string()).optional(),
    // Per-beat display-title override: { beatSlug: "Human Title" }.
    // rehype-beats prefers these over humanize(slug) at render time, so
    // acronyms and punctuation the kebab form can't express
    // (e.g. `qvcs-original-advantage` → "QVC's Original Advantage") can
    // be restored without editing the piece's body. Metadata-only
    // carve-out per the permanence rule — see DECISIONS 2026-04-19
    // "beatTitles frontmatter map for display-layer fixes".
    beatTitles: z.record(z.string(), z.string()).optional(),
    // Voice auditor's 0-100 score from the last audit round, spliced in
    // at publish time. Feeds the public-facing audit tier (polished /
    // solid / rough) via src/lib/audit-tier.ts. Optional because older
    // pieces (before this plumbing landed) don't have it.
    voiceScore: z.number().optional(),
    // Set to 'low' when Director publishes a piece that failed the
    // voice/structure/fact gates after max revisions. No longer used
    // for archive filtering (as of 2026-04-17 soften-quality pass) —
    // kept as a fallback signal for the tier helper when voiceScore
    // is missing, and for future admin/operator use.
    qualityFlag: z.enum(['low']).optional(),
    // Source news article URL — captured by Scanner into
    // daily_candidates.url, spliced by Director at publish time from
    // the picked candidate's row. Optional because pre-2026-04-22
    // pieces have no reliably resolvable URL (selectedCandidateId fix
    // landed in commit 6999c5e). Reader-side "Source: {newsSource} ↗"
    // link omits when absent.
    sourceUrl: z.string().url().optional(),
    // Verified factual claims for schema.org ClaimReview JSON-LD render
    // (Phase H, 2026-04-30) + reader-facing aggregate Sources line
    // below the meta line (Phase A, 2026-05-01). Spliced by Director
    // from the final round's verified-status claims. Sanity-capped at
    // 20 in the splicer. Optional — pre-Phase-H pieces have no field.
    //
    // Two shapes accepted via union:
    //   - Phase H legacy `string` (the single 2026-04-30 Camp Mystic
    //     piece) — claim text only, no source URLs.
    //   - Phase A object `{claim, sources?}` (2026-05-01 onward) —
    //     claim text plus the verified URLs Claude cited via
    //     web_search. BaseLayout's JSON-LD iterator normalizes both
    //     shapes; LessonLayout renders the Sources line only when at
    //     least one object item carries a usable URL.
    claimReviews: z
      .array(
        z.union([
          z.string(),
          z.object({
            claim: z.string(),
            sources: z.array(z.string()).optional(),
          }),
        ]),
      )
      .optional(),
  }),
});

/**
 * Interactives collection — standalone teaching artefacts.
 * Lives in content/interactives/
 * Filename format:
 *   - quiz: `{slug}.json` (since Area 4)
 *   - html: `{slug}-html.json` (since Phase 2 sub-task 2.5)
 *
 * Interactives are first-class (not a sub-feature of pieces). 1:1 with
 * source pieces but useful without reading the piece ("essence not
 * reference"). Two artefact types ship per piece (quiz + html) since
 * Phase 2; both share the `slug` field so they render on the same
 * /interactives/<slug>/ URL. Filenames differ to avoid Astro entry-id
 * collision (entry id is filename-without-extension; same-base-name
 * `.json` files in one dir would collide).
 *
 * Adding a future shape (breathing / game / chart) is a 2-step change:
 * widen the top-level `type` enum + add a branch to the
 * `content` discriminatedUnion.
 *
 * Source of truth: the JSON file. D1 row (`interactives` table) holds
 * metadata for admin queries; `interactives.content_json` is nullable
 * (file is authoritative).
 */
const interactives = defineCollection({
  loader: glob({
    pattern: '**/*.json',
    base: './content/interactives',
    // Astro 5's glob loader auto-uses a top-level `slug` field as the
    // entry id when present. Quiz + html files for the same piece share
    // the slug field on purpose (one URL per piece — see Phase 2 sub-
    // task 2.5), so we override generateId to use the filename instead.
    // Without this override, two entries with the same slug field would
    // collide on id and the second-loaded would silently overwrite the
    // first.
    generateId: ({ entry }) => entry.replace(/\.json$/, ''),
  }),
  schema: z.object({
    slug: z.string(),
    // 'quiz' | 'html'. Quiz path live since Area 4; HTML path added
    // Phase 2 sub-task 2.5. Two rows per piece SHARE the slug (one
    // URL per piece) — composite UNIQUE(slug, type) in D1 (migration
    // 0026) lets that work.
    type: z.enum(['quiz', 'html']),
    title: z.string(),
    // Required, non-empty. One sentence naming the underlying principle
    // the artefact teaches — feeds the page subtitle AND the per-page
    // meta description. Generator emits it on every successful round.
    // Schema-level requirement is defense in depth + an SEO contract:
    // every interactive page has a meaningful description.
    concept: z.string().min(1),
    sourcePieceId: z.string().uuid().optional(),
    interactiveId: z.string().uuid(),
    voiceScore: z.number().optional(),
    qualityFlag: z.enum(['low']).optional(),
    publishedAt: z.number(),
    content: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('quiz'),
        questions: z
          .array(
            z.object({
              question: z.string(),
              options: z.array(z.string()).min(2).max(6),
              correctIndex: z.number().int().min(0),
              explanation: z.string(),
            }),
          )
          .min(3)
          .max(5),
      }),
      z.object({
        type: z.literal('html'),
        // The full single-file HTML artefact as a string. Renders inside
        // an <iframe sandbox="allow-scripts"> — see <interactive-frame>
        // (sub-task 2.6) and docs/INTERACTIVES.md "The iframe sandbox
        // shape". Validator (agents/src/interactive-validator.ts) gates
        // this string at generation time; schema check below is just
        // a sanity floor.
        html: z.string().min(1),
      }),
    ]),
  }),
});

export const collections = { dailyPieces, interactives };
