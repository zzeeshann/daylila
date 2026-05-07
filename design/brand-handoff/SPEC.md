# Day Lila brand-icon handoff

**Status: DELIVERED 2026-05-07.** The new Day Lila assets (D-mark with gold dot, Day Lila wordmark on the OG card) replaced the live files. This folder is preserved as a record of the handoff plus a template for the next brand change.

What landed in `public/`:
- `favicon.svg` — new D-mark SVG (viewBox `0 0 32 32` — different from old `0 0 512 512`; SVG is resolution-independent so the change is harmless)
- `apple-touch-icon.png` (180×180), `icon-192.png` (192×192), `icon-512.png` (512×512) — new D-mark PNG set
- `og-image.png` (1200×630) — bonus delivery, hand-designed with the new D-mark + "Day Lila" wordmark + tagline

Source master:
- `favicon-source-1024.png` (1024×1024 Day Lila D-mark) — landed in a follow-up delivery same day. Lives at `design/favicon-source-1024.png` and is mirrored in this folder.

The originals below describe the handoff brief that was sent. Kept as-is.

---

The five files in this folder are the **current Zeemish "Z" mark** as it lives on the live site. They need to be redesigned for **Day Lila** and returned in a zip with **identical filenames** so they can be dropped straight back into their destinations.

## Brand name vs wordmark — read this first

- **Brand name** (prose, app labels, accessibility text, OS-level "Add to Home Screen" label): `Day Lila` — two words, capitalised.
- **Wordmark / logotype** (visual brand presentation in the header and on the social-share card): `daylila` — lowercase, one word. This is a typeset style, not the name.

The icon design should not contain the wordmark text — icons are too small for it. They need a **pictorial mark** instead (see "Design intent" below).

## What needs designing

| Filename in this folder | Required dimensions | Format | Where it ends up | What it does |
|---|---|---|---|---|
| `favicon.svg` | viewBox `0 0 512 512` | SVG | `public/favicon.svg` | Browser tab icon. Modern browsers prefer SVG. |
| `apple-touch-icon.png` | 180×180 px | PNG | `public/apple-touch-icon.png` | iOS Safari "Add to Home Screen". |
| `icon-192.png` | 192×192 px | PNG | `public/icon-192.png` | Android PWA icon. |
| `icon-512.png` | 512×512 px | PNG | `public/icon-512.png` | Android PWA large icon / splash. |
| `favicon-source-1024.png` | 1024×1024 px | PNG | `design/favicon-source-1024.png` | Master source — the file all PNG sizes are downscaled from. Make this one first; export the smaller PNGs from it. |

**Filenames are non-negotiable.** Same names back, same dimensions back.

## Design intent

- **Brand colours** (from `tailwind.config.js` `zee-*` tokens — kept after rebrand):
  - Teal `#1A6B62` — current background
  - Cream `#FAF8F4` — current mark colour
  - Gold accent `#C49A1A` — used elsewhere as the highlight dot

- **What it should be:** A **pictorial/abstract mark** — not a wordmark. The mark needs to read at 16×16 in a browser tab and at 180×180 on a phone home screen. "daylila" the word is too long for icon sizes; that's why we use a glyph.

- **What's there now:** A geometric "Z" (two horizontals + a diagonal) in cream on teal. That's Zeemish. We need a new mark.

- **Suggestions** (take or leave):
  - Daylily flower silhouette — petals around a centre, simplified to a few strokes
  - A "D" in the same simplified stroke style as the current Z (would keep the visual family but rebrand the letter)
  - An abstract sunrise / day-cycle mark (the "day" in daylila)

- Keep the rounded-square plate at the same corner radius (`rx=96` in the current SVG, ~18.75% of 512) so the icon shape stays familiar when readers see it next to the old one in their browser history.

## Workflow

1. Open this folder, see the five current files.
2. Redesign each one with the new mark.
3. Zip the redesigned files back up — keep the same filenames.
4. Send the zip back. The pipeline will unpack, drop each file at its destination, and update the webmanifest + robots.txt brand strings in the same commit.

## Already done — do not touch

- `public/og-image.png` (the social-share card) already says "daylila".
- `scripts/generate-og-image.mjs` already emits "daylila".
- The header wordmark in `BaseLayout.astro` is plain text "daylila" — no image.
