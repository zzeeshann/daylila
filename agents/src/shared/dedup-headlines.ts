/**
 * Hard pre-Curator deduplication filter — removes near-duplicate news
 * candidates BEFORE Curator (Claude Sonnet) ever sees them.
 *
 * Why server-side: the prompt-language approach kept failing. Three
 * incidents — 2026-04-24 (twin pieces, prediction markets), 2026-04-27
 * morning (twin SCOTUS pieces — first observation of the recurrence),
 * 2026-04-27 evening (twin SCOTUS pieces, AGAIN, despite the worked-
 * example prompt fix that explicitly named SAME-EVENT as a MUST-skip
 * failure mode and used the literal Cell-Location-Data pair as its
 * worked example). The model is rewarded for picking, not skipping.
 * "Soft preference" prompts and even worked examples don't reliably
 * survive Claude's teachability-ranking instinct when a high-newsworthy
 * already-covered story sits in the candidate set.
 *
 * Tokenize each candidate's headline + each recent piece's headline,
 * drop stopwords, count overlap. If a candidate shares enough
 * substantive tokens with a recent piece, it is filtered out of the
 * list passed to Curator. Curator literally cannot pick what it
 * cannot see.
 *
 * Limits — what this does NOT do:
 * - Detect same-CONCEPT, different-event duplicates (Hormuz + Suez
 *   chokepoints share zero substantive headline tokens). The Curator
 *   prompt's SAME-UNDERLYING-CONCEPT rule remains the defense-in-depth
 *   for that case.
 * - Block legitimate follow-ups when a story produces a substantively
 *   new teaching concept. False-positive risk is real but small —
 *   distinct news events rarely share 4+ substantive content words.
 *
 * Tunables (constants below). Adjust here, not at call sites.
 */

const STOPWORDS = new Set([
  // Articles, prepositions, conjunctions
  'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'from', 'by', 'as', 'into', 'out', 'up', 'down', 'over',
  'under', 'after', 'before', 'between', 'through', 'during', 'while',
  'since', 'until', 'against', 'per', 'about', 'amid', 'across', 'the',
  // Auxiliaries, common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'can',
  // Demonstratives, pronouns
  'this', 'that', 'these', 'those', 'it', 'its', 'their', 'they',
  'them', 'his', 'her', 'him', 'she', 'who', 'which', 'what',
  // Conjunctive / qualifying
  'if', 'then', 'than', 'so', 'also', 'just', 'not', 'no', 'yes',
  'all', 'some', 'any', 'very', 'more', 'most', 'less', 'such', 'like',
  'still', 'even', 'one', 'two',
  // News-feed framing words (don't carry topic signal)
  'says', 'said', 'reports', 'report', 'new', 'latest', 'breaking',
  'today', 'yesterday', 'week', 'amid', 'now',
]);

/** Filter candidates whose headlines share at least this many substantive
 *  tokens with any recent piece's headline. Two distinct news events
 *  rarely share 4+ content words; same-event pairs from different wire
 *  services typically share 5–9. */
export const DEDUP_MIN_SHARED_TOKENS = 4;

/** Catches short-headline matches: 3 shared on a 5-token headline = 60%
 *  ratio = same event. Without this fallback short-headline duplicates
 *  (e.g., "Trump signs order on X" / "Trump signs order on Y") slip past
 *  the absolute count threshold. */
export const DEDUP_RATIO_FALLBACK_MIN_SHARED = 3;
export const DEDUP_HIGH_RATIO_FALLBACK = 0.5;

export interface HeadlineMatch {
  matchedHeadline: string;
  sharedTokens: number;
  ratio: number;
}

/** Tokenise headline → set of substantive lowercase tokens. Strips
 *  trailing " - Source Name" / " — Source Name" suffix common in RSS
 *  feeds; drops stopwords and short tokens. */
export function tokenizeHeadline(headline: string): Set<string> {
  // Strip trailing " - Source", " — Source", " – Source" suffix.
  const stripped = headline.replace(/\s+[\-—–]\s+[^\-—–]+$/u, '');
  return new Set(
    stripped
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/** Returns the strongest match (most-overlapping recent piece) if the
 *  candidate is a duplicate of any recent headline, else null. */
export function findHeadlineMatch(
  candidateHeadline: string,
  recentHeadlines: readonly string[],
): HeadlineMatch | null {
  const candTokens = tokenizeHeadline(candidateHeadline);
  if (candTokens.size === 0) return null;

  let best: HeadlineMatch | null = null;
  for (const recent of recentHeadlines) {
    const recentTokens = tokenizeHeadline(recent);
    if (recentTokens.size === 0) continue;

    let shared = 0;
    for (const t of candTokens) if (recentTokens.has(t)) shared++;

    const minSize = Math.min(candTokens.size, recentTokens.size);
    const ratio = minSize > 0 ? shared / minSize : 0;

    const isMatch =
      shared >= DEDUP_MIN_SHARED_TOKENS ||
      (shared >= DEDUP_RATIO_FALLBACK_MIN_SHARED && ratio >= DEDUP_HIGH_RATIO_FALLBACK);

    if (isMatch && (!best || shared > best.sharedTokens)) {
      best = { matchedHeadline: recent, sharedTokens: shared, ratio };
    }
  }
  return best;
}

export interface FilteredCandidate<T> {
  candidate: T;
  match: HeadlineMatch;
}

/** Filter candidates whose headline overlaps significantly with any
 *  recent piece's headline. Returns kept (passed to Curator) and
 *  filtered (logged to observer for transparency). Order preserved. */
export function filterDuplicateCandidates<T extends { headline: string }>(
  candidates: readonly T[],
  recentHeadlines: readonly string[],
): { kept: T[]; filtered: Array<FilteredCandidate<T>> } {
  const kept: T[] = [];
  const filtered: Array<FilteredCandidate<T>> = [];
  for (const c of candidates) {
    const match = findHeadlineMatch(c.headline, recentHeadlines);
    if (match) filtered.push({ candidate: c, match });
    else kept.push(c);
  }
  return { kept, filtered };
}
