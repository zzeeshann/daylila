import type { CollectionEntry } from 'astro:content';

export type InteractiveEntry = CollectionEntry<'interactives'>;

/**
 * Bundle of interactives keyed off a single slug or sourcePieceId.
 *
 * Post-Phase-2 (sub-task 2.5), a piece can have BOTH a quiz AND an
 * html artefact sharing the same slug — they render on the same
 * `/interactives/<slug>/` URL and (with Area 5) are also embedded
 * inline at the bottom of the daily piece page.
 *
 *   primary    — the canonical entry for page-header metadata (title,
 *                concept). Quiz wins when both exist (it's the
 *                dominant artefact pre-Phase-2 and ships first when
 *                both run in the same generation pass).
 *   quizContentJson — JSON-stringified quiz content for the
 *                <quiz-card>'s `<script data-quiz-content>` payload.
 *                Null when there's no quiz.
 */
export interface InteractiveBundle {
  primary: InteractiveEntry;
  quizEntry: InteractiveEntry | null;
  htmlEntry: InteractiveEntry | null;
  quizContentJson: string | null;
}

/** A flagged-low interactive shipped with auditor concerns; surface
 *  the same hairline note copy on every render site. */
export const LOW_QUALITY_NOTE =
  "This interactive didn't pass all auditor gates. Kept live so nothing goes dark, but it may have rough edges.";

export function isLowQuality(entry: InteractiveEntry): boolean {
  return entry.data.qualityFlag === 'low';
}

/** Group a flat list of interactive entries by slug. Used by the
 *  standalone `/interactives/<slug>/` route's getStaticPaths. */
export function groupBySlug(entries: InteractiveEntry[]): Map<string, InteractiveEntry[]> {
  const out = new Map<string, InteractiveEntry[]>();
  for (const entry of entries) {
    const slug = entry.data.slug;
    const arr = out.get(slug) ?? [];
    arr.push(entry);
    out.set(slug, arr);
  }
  return out;
}

/** Build a piece-id → bundle map. Used by the daily-piece route to
 *  resolve "what interactive(s) belong to this piece" without doing
 *  the grouping work in the page template. */
export function bundleByPieceId(entries: InteractiveEntry[]): Map<string, InteractiveBundle> {
  const out = new Map<string, InteractiveBundle>();
  // Group by sourcePieceId first.
  const bySource = new Map<string, InteractiveEntry[]>();
  for (const entry of entries) {
    const pieceId = entry.data.sourcePieceId;
    if (!pieceId) continue;
    const arr = bySource.get(pieceId) ?? [];
    arr.push(entry);
    bySource.set(pieceId, arr);
  }
  for (const [pieceId, arr] of bySource) {
    const bundle = bundleFromEntries(arr);
    if (bundle) out.set(pieceId, bundle);
  }
  return out;
}

/** Build a bundle from a flat array of entries that all share a slug
 *  (or all share a sourcePieceId). Returns null if the array is empty. */
export function bundleFromEntries(entries: InteractiveEntry[]): InteractiveBundle | null {
  if (entries.length === 0) return null;
  const quizEntry = entries.find((e) => e.data.type === 'quiz') ?? null;
  const htmlEntry = entries.find((e) => e.data.type === 'html') ?? null;
  const primary = quizEntry ?? htmlEntry;
  if (!primary) return null;
  const quizContentJson =
    quizEntry && quizEntry.data.content.type === 'quiz'
      ? JSON.stringify(quizEntry.data.content)
      : null;
  return { primary, quizEntry, htmlEntry, quizContentJson };
}
