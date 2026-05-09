# Daylila Beat Contract

This document is the single source of truth for how Daylila daily pieces are *shaped*. The voice contract governs how Daylila *sounds*. The two read together at write- and audit-time.

Every published piece's shape — its word count, its number of beats, the format of its hook and teaching beats and close, its MDX frontmatter — is governed by the rules below.

## The shape

Total length across all beats: **900–1100 words.**

Target **6–8 beats per piece.** 5–8 is acceptable. 9+ is the padding zone — if a piece needs a ninth beat, the principle has already landed and you're restating it. Cut, don't add.

**Per-beat sizing.** Hook ≈ 80 words. Teaching beats 80–140 words typical, 200 hard maximum. Close 1–4 sentences (≈ 50 words). Beats are paginated single-screen units in the reader UI — a beat that runs past 200 words forces a mid-beat scroll and breaks the "one beat = one screen" affordance.

- **Hook:** One screen of text. Open with the observation that creates the question; let the question follow. Never summarise the situation before asking. No "In this lesson, we'll learn about..." — ever.
- **Teaching:** One idea per beat. Open each beat with a specific observation — a fact, a moment, a number. The principle follows from it. Never start with a definition or a generalisation. Start from the reader's own experience, build outward.
- **Practice:** Only when there's something concrete to do. Don't bolt on an exercise to fill space.
- **Close:** One to four sentences. Length is whatever makes it land — not a target. No summary. No call to action. No congratulations. Lands like the last line of a short story — it just sits there.

## The format

### Beat heading + allowed widget tags

Beats are demarcated by `## kebab-case` markdown headings only. No `<lesson-shell>` / `<lesson-beat>` / `<beat>` / `<section>` JSX tags — these break beat navigation and audio generation, both of which split on `## `.

Three widget tags ARE allowed inside a beat: `<lesson-reveal>`, `<lesson-compare>`, `<lesson-callout>`. They earn their place sparingly — see "When a beat earns a widget" below. The audio producer has widget-aware text extraction so narration stays clean (it narrates a `<lesson-reveal>` prompt and skips the body, narrates both halves of a `<lesson-compare>`, narrates a `<lesson-callout>` body inline). No other JSX tags are permitted.

Heading text is the kebab-case beat name from the brief:

    ## hook

    Body of hook beat...

    ## what-is-a-chokepoint

    Body of next beat...

### When a beat earns a widget

Most teaching beats are best as prose. A widget earns its place only when it makes the teaching land harder than prose alone would. Default is no widget. **A piece with zero widgets is a healthy outcome.** Never decorate.

Heuristic: if the widget can be deleted and the same lesson still lands, delete it. If the widget can be replaced by a sentence and the same lesson still lands, write the sentence. If neither — the widget earned its place.

The three widgets:

- **`<lesson-reveal prompt="...">body</lesson-reveal>`** — "tap to reveal" expandable. Earns its place when the reader can plausibly *guess* before reading on. Skip when the answer needs specialist knowledge — that's just hiding the lesson behind a tap.
- **`<lesson-compare><lesson-state label="...">…</lesson-state><lesson-state label="...">…</lesson-state></lesson-compare>`** — side-by-side two states. Earns its place when contrast IS the lesson (before/after, with/without) and prose would force working-memory load across paragraphs.
- **`<lesson-callout type="define|aside|note">body</lesson-callout>`** — sidebar / definition / aside. Earns its place when an inline parenthetical breaks the sentence rhythm. Skip when the inline form reads cleanly — most do.

Widget copy is governed by the voice contract — same rules as beat prose. **No reader-praise inside widgets** ("Great job!", "You got it!"). The voice rule against flattery applies inside widget bodies same as outside.

### Required frontmatter

Every published piece's MDX frontmatter must include:

`title`, `date`, `underlyingSubject`, `estimatedTime`, `beatCount`, `description`.

Additional fields (`newsSource`, `voiceScore`, `qualityFlag`, `audioBeats`, `pieceId`, `publishedAt`, `sourceUrl`, `claimReviews`) are spliced in by Director at publish time and are not the writer's concern. `newsSource` is the publisher name (e.g. `"CNN"`, `"Nature"`, `"BBC"`) — never a URL. Director sources it from `brief.newsSource` (Curator's pick) and renders verbatim into the piece's meta line as `Source: {newsSource} ↗`. The Drafter does not author this field; if a Drafter draft includes a `newsSource` line, Director's splice replaces it with the canonical value at publish time.

### SEO meta-description

The `description` frontmatter field becomes the page's `<meta name="description">` — what Google shows under the title in search results, and what social platforms use as the link-preview subtitle. Write it like a SERP snippet, not a teaser blurb.

- 140–160 characters. Google truncates around 155–160; longer descriptions get cut mid-sentence.
- Must NOT repeat the title verbatim. Title says what the piece is called; description says what the piece teaches.
- Name the underlying concept, not just the news event. The reader scanning Google has no context — they need to know what they'd learn by clicking. "Voyager 1 is running out of power 15 billion miles from Earth. NASA can't fix it — they can only choose which scientific instruments to shut down" beats "A look at NASA's Voyager 1 power problems."
- Same voice contract: plain English, no jargon, complete sentence, no marketing flourish. Reads like a thoughtful caption, not a meta tag.
