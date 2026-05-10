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

// Per-feed cap — bounds each feed's contribution. Cut 8 → 2 on
// 2026-05-11 after the post-PR-39 run showed a structural starvation
// of later feeds: PER_FEED_CAP=8 × GLOBAL_CAP=24 × feed-iteration-order
// meant the first 3 feeds (TOP, TECHNOLOGY, SCIENCE) exhausted the cap
// before BUSINESS, HEALTH, WORLD, ENTERTAINMENT, SPORTS, FOOD_COOKING,
// PERSONAL_FINANCE got any slots at all. At cap=2, 10 feeds × 2 = 20
// candidates pre-dedup (~19 post-dedup) and every feed gets exactly
// 2 slots. The editorial-contract-simplification (PR #39) unlocked
// the Curator's judgment; this fixes the feed-cap math that was
// silently constraining the pool to the first 3 feeds.
// See DECISIONS 2026-05-11 "Feed-cap rebalance".
const PER_FEED_CAP = 2;

// Global cap on candidate count stored in D1 + passed to Curator.
// Cut 80 → 24 on 2026-05-10. The cap is per-run, not per-day — each
// pipeline run pulls fresh news, so pool depth across runs isn't a
// concern. SAME-EVENT / SAME-CONCEPT hard skips + the recent-pieces
// headline list already prevent the Curator from picking anything we've
// covered; pool depth isn't carrying that load. Library check at the
// time of the cut: 58 pieces, 11 categories — the deep pool wasn't
// producing real variety. Latency reading at the time of the cut:
// Curator clocked 141.8s on the 2026-05-10 run, past the CF Workers
// 125s subrequest idle limit (streaming from the 2026-05-09 fix is the
// only reason that run didn't 499). The trim is the latency-margin
// fix the streaming workaround is currently hiding.
// See DECISIONS 2026-05-10 "Curator input trim".
const GLOBAL_CAP = 24;

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
          // 150-char cap. Each candidate's summary feeds into Curator's
          // prompt verbatim. Google News RSS descriptions are
          // auto-generated leads; 150 chars carry the headline angle
          // and the lede sentence — which is what Curator needs to
          // judge teachability. Cut from 250 on 2026-05-10 alongside
          // the GLOBAL_CAP 80 → 24 trim; the per-candidate reasoning
          // the contract asks for doesn't need 250 chars per row.
          // History: was 500 pre-2026-05-09, dropped to 250 in the
          // Curator timeout regression fix, dropped again to 150 here.
          // See DECISIONS 2026-05-10 "Curator input trim".
          summary: this.cleanHtml(description || '').slice(0, 150),
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
