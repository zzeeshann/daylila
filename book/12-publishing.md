# 12 — Publishing: from MDX to the live site

*Status: outline. To be expanded by a future session — see WRITING-MORE.md.*

---

## What this chapter covers

- What MDX is — Markdown extended to include components. Why Daylila uses MDX instead of plain Markdown.
- Astro — the framework that turns MDX files into HTML pages. What "static site generation" means.
- The build pipeline: commit to GitHub → GitHub Actions fires → Astro builds → Cloudflare Workers serves.
- Rehype plugins — specifically `rehype-beats.ts`, which transforms the MDX beats into interactive Web Components.
- The `<lesson-shell>` and `<lesson-beat>` Web Components — what they do for the reader, how they work.
- The `beatTitles` frontmatter map — why it exists (see the heading bug story from the April 2026 session) and how it's used.
- The permanence rule: published pieces are never rewritten. Metadata-only edits are the documented exception (audio URLs, beat titles, the `qualityFlag` stamp the audit contract describes when a piece ships after failing three rounds — see `content/audit-contract.md`).

## Why this matters for Daylila

- The publishing step is where agents stop and the reader surface begins. It's the bridge between the factory and the shop floor.
- Understanding it helps explain why some things are fast (the site itself) and why some things are paused between commits (the GitHub Actions build).

## Key terms introduced

- MDX, Astro, static site generation, Web Component, frontmatter, rehype, transform, CDN cache
