/**
 * piece-stats — single source of truth for word count + beat count.
 *
 * Derives both numbers from the published MDX body. Replaces the
 * `daily_pieces.word_count` + `beat_count` columns, which were
 * written from Curator's BRIEF (planned numbers) and drifted away
 * from what Drafter actually shipped — the drawer would say "4 beats"
 * while the dot row showed 6, because brief.beats.length and the
 * actual `## ` heading count are two different things.
 *
 * MDX is now the only source of truth. The D1 columns are inert as
 * of 2026-05-09 (PR #0); a future migration drops them.
 *
 * Beat count mirrors rehype-beats — lines starting with `## ` (h2).
 * Word count is whitespace-split on the body with HTML tags stripped.
 */

export interface PieceStats {
  wordCount: number;
  beatCount: number;
}

export function computePieceStats(body: string): PieceStats {
  // Defensive: glob-loader entries already have frontmatter stripped,
  // but raw file reads don't. Strip if present.
  const stripped = body.replace(/^---\n[\s\S]*?\n---\n?/, '');

  // Beat count: same rule as src/lib/rehype-beats.ts — h2 demarcates a beat.
  const beatMatches = stripped.match(/^## /gm);
  const beatCount = beatMatches ? beatMatches.length : 0;

  // Word count: strip HTML/JSX tags and common markdown punctuation,
  // then whitespace-split. Approximation; matches what 200-wpm reading-
  // minute estimates have always assumed.
  const words = stripped
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_~`>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  return { wordCount: words.length, beatCount };
}
