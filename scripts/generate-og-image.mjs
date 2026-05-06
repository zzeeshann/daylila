#!/usr/bin/env node
/**
 * One-off generator for public/og-image.png.
 *
 * Run when the OG card design changes:
 *   node scripts/generate-og-image.mjs
 *
 * Renders the SVG below to a 1200×630 PNG via the sharp library
 * (already a transitive dep of Astro — see package.json
 * onlyBuiltDependencies). Fonts fall back to the rendering system's
 * sans-serif (Helvetica Neue on macOS) — DM Sans isn't embedded in the
 * SVG because that would require shipping the font file alongside the
 * generator. The result is a static PNG; no per-piece dynamic OG.
 *
 * See docs/DECISIONS.md 2026-04-25 "Replace SVG og:image with PNG" for
 * rationale (PNG over SVG: social platforms don't render SVG OG; static
 * over dynamic: per-piece OG is a separate Worker route project).
 */

import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'public', 'og-image.png');

// 1200×630 — Twitter / LinkedIn / Facebook / WhatsApp / iMessage card spec.
// Brand colours match tailwind.config.js zee-* tokens.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FAF8F4"/>

  <text x="80" y="110"
        font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"
        font-size="44" font-weight="700"
        fill="#1A6B62"
        letter-spacing="-1.5">daylila</text>

  <circle cx="1120" cy="100" r="6" fill="#C49A1A"/>

  <text x="600" y="320"
        text-anchor="middle"
        font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"
        font-size="56" font-weight="700"
        fill="#1A1A1A"
        letter-spacing="-2">Educate yourself for humble decisions.</text>

  <rect x="556" y="360" width="88" height="4" fill="#C49A1A" rx="2"/>
</svg>`;

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
await writeFile(outPath, png);

const meta = await sharp(png).metadata();
console.log(`Wrote ${outPath}`);
console.log(`Dimensions: ${meta.width}×${meta.height}, ${png.length} bytes`);
