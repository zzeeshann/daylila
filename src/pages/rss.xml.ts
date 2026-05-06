import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { deriveSlug, pieceUrl } from '../lib/slug';

export const prerender = false;

// Hand-rolled rather than @astrojs/rss because the package's default
// guid is the link with isPermaLink="true" and the spec calls for
// pieceId as a stable non-URL guid. Also keeps the dependency
// surface flat (CLAUDE.md "no new deps without justification").
//
// RSS 2.0 over Atom — broadest reader support across Feedly,
// Inoreader, NetNewsWire, and the various AI ingestion pipelines
// that consume feeds. Description-only for v1; full <content:encoded>
// can be added later if there's reader demand.

function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&apos;',
  );
}

export async function GET(context: APIContext): Promise<Response> {
  const site = context.site?.toString().replace(/\/$/, '') ?? 'https://daylila.com';
  const feedUrl = `${site}/rss.xml`;
  const channelLink = `${site}/`;

  const pieces = await getCollection('dailyPieces');
  const sorted = [...pieces].sort((a, b) => b.data.publishedAt - a.data.publishedAt);

  const lastBuildDate = sorted[0]
    ? new Date(sorted[0].data.publishedAt).toUTCString()
    : new Date().toUTCString();

  const items = sorted
    .map((p) => {
      const link = `${site}${pieceUrl(p.data.date, deriveSlug(p.id))}`;
      const pubDate = new Date(p.data.publishedAt).toUTCString();
      return [
        '    <item>',
        `      <title>${xmlEscape(p.data.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="false">${xmlEscape(p.data.pieceId)}</guid>`,
        `      <pubDate>${pubDate}</pubDate>`,
        `      <description>${xmlEscape(p.data.description)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>Daylila — daily pieces</title>',
    `    <link>${channelLink}</link>`,
    '    <description>Educate yourself for humble decisions. A daily teaching piece anchored in today\u2019s news, made by an autonomous team of agents.</description>',
    '    <language>en</language>',
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
