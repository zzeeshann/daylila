# Daylila Beat Contract

This document is the single source of truth for how Daylila daily pieces are *shaped*. The voice contract governs how Daylila *sounds*. The two read together at write- and audit-time.

Every published piece's shape — its word count, its number of beats, the format of its hook and teaching beats and close, its MDX frontmatter — is governed by the rules below.

## The shape

Total length across all beats: **1000–1500 words.**

Target **5–6 beats per piece.** 3–6 is acceptable. 7+ is the padding zone — if a piece needs a seventh beat, the principle has already landed and you're restating it. Cut, don't add.

- **Hook:** One screen of text. Open with the observation that creates the question; let the question follow. Never summarise the situation before asking. No "In this lesson, we'll learn about..." — ever.
- **Teaching:** One idea per beat. Open each beat with a specific observation — a fact, a moment, a number. The principle follows from it. Never start with a definition or a generalisation. Start from the reader's own experience, build outward.
- **Practice:** Only when there's something concrete to do. Don't bolt on an exercise to fill space.
- **Close:** One to four sentences. Length is whatever makes it land — not a target. No summary. No call to action. No congratulations. Lands like the last line of a short story — it just sits there.

## The format

### No JSX tags

Beats are demarcated by `## kebab-case` markdown headings only. No `<lesson-shell>` / `<lesson-beat>` / `<beat>` / `<section>` JSX tags. Downstream renderers and the audio producer both split on `## ` — any other syntax silently breaks beat navigation and audio generation.

Heading text is the kebab-case beat name from the brief:

    ## hook

    Body of hook beat...

    ## what-is-a-chokepoint

    Body of next beat...

### Required frontmatter

Every published piece's MDX frontmatter must include:

`title`, `date`, `newsSource`, `underlyingSubject`, `estimatedTime`, `beatCount`, `description`.

Additional fields (`voiceScore`, `qualityFlag`, `audioBeats`, `pieceId`, `publishedAt`, `sourceUrl`, `claimReviews`) are spliced in by Director at publish time and are not the writer's concern.

### SEO meta-description

The `description` frontmatter field becomes the page's `<meta name="description">` — what Google shows under the title in search results, and what social platforms use as the link-preview subtitle. Write it like a SERP snippet, not a teaser blurb.

- 140–160 characters. Google truncates around 155–160; longer descriptions get cut mid-sentence.
- Must NOT repeat the title verbatim. Title says what the piece is called; description says what the piece teaches.
- Name the underlying concept, not just the news event. The reader scanning Google has no context — they need to know what they'd learn by clicking. "Voyager 1 is running out of power 15 billion miles from Earth. NASA can't fix it — they can only choose which scientific instruments to shut down" beats "A look at NASA's Voyager 1 power problems."
- Same voice contract: plain English, no jargon, complete sentence, no marketing flourish. Reads like a thoughtful caption, not a meta tag.
