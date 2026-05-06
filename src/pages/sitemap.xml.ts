import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { deriveSlug, pieceUrl } from '../lib/slug';
import { getCategories } from '../lib/categories';

export const prerender = false;

// Hand-rolled rather than @astrojs/sitemap because the integration only
// emits prerendered routes — /library/ and /library/<slug>/ are SSR
// (Area 2 sub-task 2.4) and category slugs live in D1, neither of
// which the integration can see at build time. One SSR endpoint
// enumerates everything cleanly.

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: 'daily' | 'weekly' | 'monthly';
  priority?: string;
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&apos;',
  );
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const parts: string[] = [`    <loc>${xmlEscape(e.loc)}</loc>`];
      if (e.lastmod) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority) parts.push(`    <priority>${e.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export async function GET(context: APIContext): Promise<Response> {
  const site = context.site?.toString().replace(/\/$/, '') ?? 'https://daylila.com';
  const abs = (path: string) => `${site}${path}`;

  const pieces = await getCollection('dailyPieces');
  const sortedPieces = [...pieces].sort((a, b) => b.data.publishedAt - a.data.publishedAt);
  const newestPublishedAt = sortedPieces[0]?.data.publishedAt;
  const latestLastmod = newestPublishedAt ? isoDate(newestPublishedAt) : undefined;

  const interactives = await getCollection('interactives');

  // Categories live in D1, fail-open on DB error so a transient outage
  // doesn't poison the whole sitemap. Static entries always render.
  let categories: Awaited<ReturnType<typeof getCategories>> = [];
  try {
    const db = context.locals.runtime.env.DB;
    if (db) categories = await getCategories(db);
  } catch {
    categories = [];
  }

  const entries: SitemapEntry[] = [];

  // Static landing pages
  entries.push({ loc: abs('/'), lastmod: latestLastmod, changefreq: 'daily', priority: '1.0' });
  entries.push({ loc: abs('/daily/'), lastmod: latestLastmod, changefreq: 'daily', priority: '0.9' });
  entries.push({ loc: abs('/library/'), lastmod: latestLastmod, changefreq: 'daily', priority: '0.9' });

  // Daily pieces — slug-inclusive URL per Phase 4 (2026-04-21)
  for (const piece of sortedPieces) {
    entries.push({
      loc: abs(pieceUrl(piece.data.date, deriveSlug(piece.id))),
      lastmod: isoDate(piece.data.publishedAt),
      changefreq: 'monthly',
      priority: '0.8',
    });
  }

  // Interactives — standalone-addressable per Area 4 (2026-04-24)
  for (const interactive of interactives) {
    entries.push({
      loc: abs(`/interactives/${interactive.data.slug}/`),
      lastmod: isoDate(interactive.data.publishedAt),
      changefreq: 'monthly',
      priority: '0.6',
    });
  }

  // Category pages
  for (const category of categories) {
    entries.push({
      loc: abs(`/library/${category.slug}/`),
      lastmod: latestLastmod,
      changefreq: 'weekly',
      priority: '0.5',
    });
  }

  return new Response(renderSitemap(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
