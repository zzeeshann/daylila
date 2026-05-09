import { Agent } from 'agents';
import type { Env } from './types';

export interface NewsCandidate {
  id: string;
  headline: string;
  source: string;
  category: string;
  summary: string;
  url: string;
}

interface ScannerState {
  lastScanned: number | null;
  candidateCount: number;
}

// RSS feeds — free, no API key needed.
//
// 6 Google News topic feeds (TOP / TECHNOLOGY / SCIENCE / BUSINESS /
// HEALTH / WORLD) supply the news anchor that the daily-piece concept
// needs. These re-aggregate wire services and skew toward
// breaking-news / crisis / policy framings.
//
// 11 direct breadth feeds (added 2026-05-01) widen the input to surface
// stories in the underserved domains from Curator's TEACHABILITY breadth
// taxonomy (Inner life / Meaning / Expression / Language / Science as
// discovery / Body / How humans live together / Skills / Technology
// beyond crisis / Time and place). Each is a verified RSS 2.0 feed
// parseable by fetchFeed's existing regex (Atom-only sources like The
// Conversation US were considered and dropped — adding Atom parsing was
// out of scope).
//
// Per-feed cap and global cap tuned so direct feeds get budget — see
// PER_FEED_CAP and GLOBAL_CAP below.
//
// See DECISIONS 2026-05-01 "Scanner default feeds widened from 6 Google
// News topics to 17 feeds for breadth".
const RSS_FEEDS: Record<string, string> = {
  // Google News topic feeds (news anchor; the original 6 since launch)
  TOP: 'https://news.google.com/rss?hl=en&gl=US&ceid=US:en',
  TECHNOLOGY: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
  SCIENCE: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
  BUSINESS: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
  HEALTH: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ?hl=en&gl=US&ceid=US:en',
  WORLD: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
  // Pop-culture / sport / food / personal-finance widening (PR #1, 2026-05-09).
  // The 11 narrow-academic breadth feeds added 2026-05-01 (AEON, QUANTA,
  // JSTOR_DAILY, ATLAS_OBSCURA, NAUTILUS, PHYS_ORG, LIVE_SCIENCE,
  // NEW_SCIENTIST, KNOWABLE, SMITHSONIAN, TECH_REVIEW) skewed the candidate
  // pool toward hard-science/academic; 7-of-11 were explicitly science
  // publications. Curator's contract is breadth-aware (10-domain taxonomy
  // at content/curator-contract.md:19-28 explicitly invites celebrity /
  // sport / cooking / culture) but cannot pick what's not in the pool.
  // Replacement: 4 more Google News feeds covering the underserved
  // domains. Curator filters gossip / score-recap noise via low_signal /
  // tribal_framing rejection categories — the teachable ~30% of these
  // feeds is exactly what the library was missing.
  // See DECISIONS 2026-05-09 "PR #1 — Source mix widened".
  ENTERTAINMENT: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en',
  SPORTS: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en',
  FOOD_COOKING: 'https://news.google.com/rss/search?q=food+cooking+science&hl=en-US&gl=US&ceid=US:en',
  PERSONAL_FINANCE: 'https://news.google.com/rss/search?q=personal+finance&hl=en-US&gl=US&ceid=US:en',
};

// Per-feed cap — bounds each feed's contribution so wire-service feeds
// don't crowd out direct breadth feeds. Lifted 6 → 8 on 2026-05-09
// (PR #1) when the feed list shrank from 17 to 10: 10 feeds × 8 = 80
// candidates pre-dedup, dedup to ~60-70 unique, cap to GLOBAL_CAP.
// At cap 6 the new feed mix would only produce ~60 candidates pre-dedup
// — too thin given Curator's expected higher rejection rate on the
// Entertainment / Sports gossip-vs-craft mix.
const PER_FEED_CAP = 8;

// Global cap on candidate count stored in D1 + passed to Curator.
// Raised from 50 to 80 on 2026-05-01 to match the feed-count expansion
// — keeps direct feeds proportionally represented while preserving
// Google News news-anchor coverage. ~50KB total candidate-row text in
// the Curator prompt; well within Sonnet's context budget.
const GLOBAL_CAP = 80;

/**
 * ScannerAgent — fetches news from Google News RSS daily.
 * Parses headlines, deduplicates, stores candidates in D1.
 * The Director then picks the most teachable story.
 */
export class ScannerAgent extends Agent<Env, ScannerState> {
  initialState: ScannerState = { lastScanned: null, candidateCount: 0 };

  /** Scan all RSS feeds and store candidates. `pieceId` is the
   *  run-scoped UUID pre-allocated by Director at the top of
   *  triggerDailyPiece — stamped onto every candidate row so the
   *  admin per-piece view can filter candidates by piece_id at
   *  multi-per-day cadence. Orphan piece_ids (scanner-skipped runs)
   *  are acceptable; readers filter on daily_pieces.id JOIN where
   *  needed. See DECISIONS 2026-04-22 "piece_id columns on day-keyed
   *  tables". */
  async scan(pieceId: string, runId: string | null = null): Promise<NewsCandidate[]> {
    const today = new Date().toISOString().slice(0, 10);
    const allCandidates: NewsCandidate[] = [];
    const seenHeadlines = new Set<string>();

    // Optional env override — lets ops change feeds without a redeploy.
    // Malformed JSON silently falls back to the hardcoded defaults below.
    let feeds: Record<string, string> = RSS_FEEDS;
    if (this.env.SCANNER_RSS_FEEDS_JSON) {
      try {
        feeds = JSON.parse(this.env.SCANNER_RSS_FEEDS_JSON);
      } catch {
        feeds = RSS_FEEDS;
      }
    }

    for (const [category, feedUrl] of Object.entries(feeds)) {
      try {
        const candidates = await this.fetchFeed(feedUrl, category);
        for (const c of candidates) {
          // Deduplicate by headline similarity
          const key = c.headline.toLowerCase().slice(0, 60);
          if (!seenHeadlines.has(key)) {
            seenHeadlines.add(key);
            allCandidates.push(c);
          }
        }
      } catch {
        // One feed failing shouldn't stop others
      }
    }

    // Store in D1
    const now = Date.now();
    for (const candidate of allCandidates.slice(0, GLOBAL_CAP)) {
      try {
        await this.env.DB
          .prepare(
            `INSERT OR IGNORE INTO daily_candidates (id, date, headline, source, category, summary, url, created_at, piece_id, run_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(candidate.id, today, candidate.headline, candidate.source, candidate.category, candidate.summary, candidate.url, now, pieceId, runId)
          .run();
      } catch { /* continue */ }
    }

    this.setState({ lastScanned: now, candidateCount: allCandidates.length });
    return allCandidates.slice(0, GLOBAL_CAP);
  }

  /** Get today's candidates from D1 */
  async getTodayCandidates(): Promise<NewsCandidate[]> {
    const today = new Date().toISOString().slice(0, 10);
    const result = await this.env.DB
      .prepare('SELECT * FROM daily_candidates WHERE date = ? ORDER BY created_at')
      .bind(today)
      .all<NewsCandidate & { date: string; created_at: number }>();
    return result.results;
  }

  /** Fetch and parse a Google News RSS feed */
  private async fetchFeed(url: string, category: string): Promise<NewsCandidate[]> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Daylila/1.0 (news aggregator for educational content)' },
    });

    if (!response.ok) return [];
    const xml = await response.text();

    // Simple XML parsing — extract <item> elements
    const items: NewsCandidate[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = this.extractTag(itemXml, 'title');
      const link = this.extractTag(itemXml, 'link');
      const description = this.extractTag(itemXml, 'description');
      const source = this.extractTag(itemXml, 'source');

      if (title) {
        items.push({
          id: crypto.randomUUID(),
          headline: this.cleanHtml(title),
          source: source || category,
          category,
          // 250-char cap (was 500). Each candidate's summary feeds into
          // Curator's prompt verbatim; at ~80 candidates this halves
          // ~7k input tokens per Curator call. Google News RSS
          // descriptions are auto-generated leads — the first ~250
          // chars carry the headline angle and the lede sentence,
          // which is what Curator needs to judge teachability.
          // Reverting requires bumping Curator's max_tokens headroom.
          // See DECISIONS 2026-05-09 "Curator 124s 499 timeout regression".
          summary: this.cleanHtml(description || '').slice(0, 250),
          url: link || '',
        });
      }
    }

    return items.slice(0, PER_FEED_CAP);
  }

  private extractTag(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return match?.[1]?.trim() ?? '';
  }

  private cleanHtml(text: string): string {
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
