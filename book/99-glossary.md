# 99 — Glossary

Every term this book uses, in plain English. If you see a word you don't recognise anywhere in the book, it should be defined here. Alphabetical.

---

**Agent.** A program that uses a language model to make one or more decisions, then acts on those decisions. In Zeemish's code, "agent" is also the name given to sixteen specific files that each handle one role in the pipeline — some use Claude (like Curator, Drafter, Categoriser, Interactive Generator), some don't (like Scanner, Publisher). See chapter 6.

**Alarm.** A scheduled callback in Cloudflare's Durable Object system. A Durable Object can tell itself "run this method N seconds from now," and the system will fire it in a fresh invocation with its own time budget. Zeemish uses alarms to run the audio pipeline, Learner, and Drafter self-reflection without blocking the main request.

**Astro.** The framework Zeemish uses to build the website. Takes MDX files and turns them into HTML pages. Supports "static site generation" (building the pages once, serving the built files) and "server-side rendering" (building pages on demand).

**Audit contract.** The versioned document that defines how Zeemish *judges* its own work: the three audit gates (voice scored 0–100 passing at 85, structure binary, facts binary), the three-round revision bound, the rule that ships a piece anyway with a Rough tier when those rounds max-fail, the closed `qualityFlag` taxonomy, and the reader-facing tier mapping (Polished / Solid / Rough). Lives at `content/audit-contract.md`. Extracted 2026-05-06; the same value applies to the daily-piece auditor loop and the post-publish interactive loop, so a single shared constant carries it. The voice, beat, and interactive contracts are its companions: voice governs how Zeemish *sounds*, beat governs how *daily pieces* are shaped, interactive governs how the post-publish artefacts are shaped, and audit governs how all of it is *judged*.

**Audio contract.** The versioned document that defines how Zeemish *narrates* its daily pieces: the ElevenLabs voice (Frederick Surrey, added to the operator's "My Voices" library so the ID survives shared-library removals), the model (`eleven_multilingual_v2`, chosen so the voice handles non-English proper nouns without prosody collapse), the output format (44.1 kHz MP3 at 96 kbps — indistinguishable from 128 for a single voice, ~25% smaller R2 footprint), the 20,000-character per-piece spend cap (sized for a 12-beat piece × ~200 words/beat + headroom), the 3-attempt retry policy (4xx no-retry, 5xx + network do retry, 90-second per-attempt timeout, 1s/2s exponential backoff), and the per-call 2-beat budget that keeps each producer call under Cloudflare's Durable Object 30-second wall-clock ceiling. Lives at `content/audio-contract.md`. Extracted 2026-05-09. No Claude prompt currently injects the contract — the Audio Producer makes zero Claude calls (TTS-only via ElevenLabs HTTP) and the Audio Auditor makes zero Claude calls (R2 HEAD checks only) — so the contract is canonical narrative; runtime values flow through six named constants in `agents/src/shared/audio-thresholds.ts`. Agents-only — no site-side mirror; the display-side label lookups in the made-drawer are render-time reads against persisted column values, not rule mirrors. Companion to the voice, beat, interactive, audit, fact-check, and curator contracts: voice governs how Zeemish *sounds*, beat governs how *daily pieces* are shaped, interactive governs how the post-publish artefacts are shaped, audit governs how all of it is *judged*, fact-check governs how the writing is *verified*, curator governs how the day's story is *picked*, and audio governs how the piece is *narrated*.

**Auditor.** An agent whose job is to judge quality. Voice Auditor, Fact Checker, and Structure Editor are Zeemish's three auditors. See chapter 11.

**Beat.** One section of a Zeemish piece. Typically a piece has 4–6 beats: Hook, Teaching (2–3 beats), Watch, Close. Each beat is its own MDX `##` heading and gets its own audio clip.

**Beat contract.** The versioned document that defines how Zeemish pieces are *shaped*: 1000–1500 words, 5–6 beats target, hook format, ONE idea per teaching beat, close 1–4 sentences, no JSX tags, MDX frontmatter required fields, SEO meta-description rules. Lives at `content/beat-contract.md`. Read at runtime by the Drafter (when writing), the Structure Editor (when auditing), and the Integrator (when revising). The voice contract is its companion: voice contract governs how Zeemish *sounds*, beat contract governs how Zeemish is *shaped*.

**Categoriser contract.** The versioned document that defines how Zeemish *files* each piece in the library taxonomy: every piece lands in 1–3 categories (never zero), the 75-confidence ideal-reuse floor, the 60-confidence stretch-reuse floor (sub-floor existing-category assignments are dropped resolver-side), the at-most-one-new-category-per-run discipline (durable subjects, ≥10 future pieces, kebab-case slug), the empty-array prohibition with single-retry recovery, and the reserved `patterns-yet-to-cluster` fallback slug (hidden from every reader-facing surface; an operator review signal, not a browseable category). Lives at `content/categoriser-contract.md`. Extracted 2026-05-10. Read at runtime by the Categoriser (via `${CATEGORISER_CONTRACT}` injection in its system prompt). The four named values flow through a small shared module on the agents side; the site worker carries only the fallback slug as an asymmetric mirror — the site enforces just the fallback-slug filter at render time (chip bar, per-piece drawer, account observation), since the floors and the assignment cap are agents-only rules. Migration 0027 seeds the fallback row at first deploy; the slug literal there is data, frozen at deploy time, treated as a deliberate non-change. Companion to the voice, beat, interactive, audit, fact-check, curator, and audio contracts: voice governs how Zeemish *sounds*, beat governs how *daily pieces* are shaped, interactive governs how the post-publish artefacts are shaped, audit governs how all of it is *judged*, fact-check governs how the writing is *verified*, curator governs how the day's story is *picked*, audio governs how the piece is *narrated*, and categoriser governs how each piece is *filed*. With this entry the eight Foundation Fix Phase 1 contracts are complete.

**Claude.** A specific AI language model made by Anthropic. Zeemish uses the Sonnet 4.5 version. See chapter 5.

**Claude Code.** Anthropic's command-line tool for delegating coding tasks to Claude. Different from "Claude" the chat assistant — same underlying model, different interface designed for editing repos.

**Cloudflare.** The company that runs Zeemish's code. A global network of data centres that runs small programs (Workers) close to users. See chapter 3.

**Codegen.** A small script that runs before the agents bundle is built. Reads canonical files (the voice contract markdown, the HTML reference, the beat contract markdown, the interactive contract markdown, the audit contract markdown, the fact-check contract markdown, the curator contract markdown, the audio contract markdown, the categoriser contract markdown) and writes a TypeScript file the bundle imports as a string. Cloudflare Workers cannot read files at runtime, so anything an agent needs to read at runtime has to be embedded at build time. The script — `agents/scripts/codegen-contracts.mjs` — replaced two hand-maintained mirror files that had silently drifted from canonical. New contracts are added by appending to its SOURCES list; the beat contract joined on 2026-05-04, the interactive contract on 2026-05-05, the audit contract on 2026-05-06, the fact-check contract on 2026-05-07, the curator contract on 2026-05-08, the audio contract on 2026-05-09, and the categoriser contract on 2026-05-10 as the second, third, fourth, fifth, sixth, seventh, and eighth (and final Phase 1) extracted clusters. See chapter 6.

**Commit.** A saved snapshot of a change in Git, with a message explaining what changed.

**Cron.** A scheduled task that runs at a set time. Zeemish's pipeline runs on an hourly cron gated by `admin_settings.interval_hours` — at the default (24) only the 02:00 UTC slot fires, so in practice it's once a day.

**Curator contract.** The versioned document that defines how Zeemish *picks* its daily story: the five selection criteria in priority order (teachability, universality, freshness, depth potential, no tribal framing), the ten-domain breadth taxonomy that lives under teachability, the recent-category soft preference (avoid the categories already at three or more pieces in the last thirty days, unless the news genuinely demands it), the SAME-EVENT and SAME-CONCEPT hard skips with their three worked examples, and the skip output shape (the reason must name the specific condition, never a category dismissal). Lives at `content/curator-contract.md`. Extracted 2026-05-08. Read at runtime by the Curator (via `${CURATOR_CONTRACT}` injection in its system prompt). The thirty-day data window for recent pieces and category counts is exported as a single named constant on the agents side; agents-only, no site-side mirror — the site does not read curator rules at render time. The Zeemish protocol three-sentence opener stays inline in the Curator prompt (voice-contract.md is the protocol's canonical home; Curator lifts it as system-prompt framing for picking, not as a rule to enforce). Companion to the voice, beat, interactive, audit, and fact-check contracts: voice governs how Zeemish *sounds*, beat governs how *daily pieces* are shaped, interactive governs how the post-publish artefacts are shaped, audit governs how all of it is *judged*, fact-check governs how the writing is *verified*, and curator governs how the day's story is *picked*.

**D1.** Cloudflare's relational database service. Based on SQLite. Zeemish uses it for structured data (pieces, audit results, learnings, users). See chapter 4.

**Durable Object.** A special kind of Cloudflare Worker that has persistent state and lives in one specific location. Can remember things between calls. Zeemish's sixteen agents are each implemented as a Durable Object.

**ElevenLabs.** The voice-synthesis service Zeemish uses to turn piece text into audio narration. See chapter 7.

**Fact-check contract.** The versioned document that defines how Zeemish *verifies* its own writing: the closed verdict taxonomy (`verified` / `unverified` / `incorrect`) with the rule that absence of evidence is `unverified` and never `incorrect`, the search-first rule for any claim with a name, date, number, or current-event reference, the ban on confessing the model's training cutoff to readers (with the canonical phrase list the drawer's render-time defense filter matches against), and the eight-search budget for the Anthropic web_search server tool. Lives at `content/fact-check-contract.md`. Extracted 2026-05-07. Read at runtime by the Fact Checker (via `${FACT_CHECK_CONTRACT}` injection in its system prompt). The drawer's render-time filter on the site worker reads the same canonical phrase list via a small TypeScript constant. Companion to the voice, beat, interactive, and audit contracts: voice governs how Zeemish *sounds*, beat governs how *daily pieces* are shaped, interactive governs how the post-publish artefacts are shaped, audit governs how all of it is *judged*, and fact-check governs how the writing is *verified*.

**Frontmatter.** Metadata at the top of an MDX file, between two `---` lines. Contains things like the piece's title, date, voice score, and audio URLs.

**Git.** A system for tracking every version of every file in a project. Works locally without the internet. GitHub is a website that hosts Git projects.

**GitHub.** A website owned by Microsoft that hosts Git projects. Zeemish's code lives at `github.com/zzeeshann/zeemish-v2`. See chapter 2.

**GitHub Actions.** GitHub's built-in system for automatically running tasks when something happens in a repo. Zeemish uses it to deploy both workers to Cloudflare on every push to main.

**Hallucination.** When a language model confidently produces text that is factually incorrect. Inherent to how LLMs work, not a bug that will be fixed.

**HTTP / HTTPS.** The protocol browsers use to talk to websites. HTTPS is the encrypted version, used everywhere today.

**Interactive contract.** The versioned document that defines how Zeemish quizzes and HTML interactives are *shaped*: the essence-not-reference rule, the six hard prohibitions (no proper nouns, dates, quoted phrases, "according to" phrasing, piece-specific numbers, recognisable industry labels), the Plain English split rule with its 13-word jargon translation list, the quiz shape (3–5 questions, 4 options, plausible wrong answers, 1–2 sentence explanations), the eight HTML interactive shape rules (one clear surface, teaching label, mobile-respectable, manipulation embodies the mechanism, etc.), the validator constraints, and the title / concept / slug rules. Lives at `content/interactive-contract.md`. Read at runtime by the Interactive Generator (both quiz and HTML paths) and the Interactive Auditor (both paths). Companion to the voice contract and the beat contract: voice governs how Zeemish *sounds*, beat governs how *daily pieces* are shaped, interactive governs how the post-publish artefacts are shaped.

**Knowledge cutoff.** The date after which a language model has no information. If something happened after the cutoff, the model doesn't know, though it may confidently produce text that sounds like it does.

**KV.** Cloudflare's key-value store. For simple "this key maps to this value" lookups. Zeemish uses it for rate limiting. See chapter 4.

**Language model (LLM).** A computer program that predicts what text is most likely to come next, given some starting text. Claude is one. See chapter 5.

**Learnings.** A table in Zeemish's D1 database that stores observations about past pieces, with a `source` column indicating whether each observation came from readers, the producer side, self-reflection, or Zita. The Drafter reads from this table at runtime. See chapter 14.

**Markdown.** A plain-text format for writing formatted documents. `#` for headings, `*` for italic, etc. This book is written in Markdown.

**MDX.** Markdown extended to allow including components (like `<audio-player>`). Zeemish's daily pieces are MDX files.

**Migration.** A database change — adding a column, creating a table. Each is numbered and stored in `migrations/`. Applied to production manually via `wrangler` in Zeemish's workflow.

**Object storage.** A kind of storage optimised for big binary files (images, audio, video). Unlike a database, you hand it a file and get a URL back. Cloudflare's version is called R2.

**Prompt.** The text sent to a language model to get a response. Most of the interesting design work in an AI system is in the prompts — what you include, what you leave out, how you phrase the instruction.

**Pull request.** On GitHub, a proposal to merge a branch. Reviewed before it lands.

**R2.** Cloudflare's object storage service. Similar to Amazon S3, but cheaper for streaming because Cloudflare doesn't charge egress fees. Zeemish uses it for audio clips. See chapter 4.

**Repository (repo).** A folder of files plus their full Git history.

**RSS.** An old but still widely used format for publishing news feeds. Scanner reads news via RSS.

**Server.** A computer running all the time that answers requests from other computers over the internet. Zeemish doesn't have a traditional server — it has Cloudflare Workers instead.

**SQL.** The language used to query relational databases. Reading basic SQL gets you 80% of the way.

**SQLite.** A small, fast, widely-used database engine. Powers D1 under the hood.

**Tier.** The label Zeemish attaches to each published piece based on its final voice score. `Polished` (≥85), `Solid` (70–84), `Rough` (<70). Threshold values and the publish-anyway-on-Rough rule live in the audit contract since 2026-05-06 — see `content/audit-contract.md`.

**Voice contract.** The versioned document in the Zeemish repo that defines how the publication writes. Plain English, no tribe words, short sentences, hospitality principle. Lives at `content/voice-contract.md`. Loaded into the Drafter's prompt every time.

**Web Component.** A standard browser feature for building reusable UI elements with custom HTML tags. Zeemish uses Web Components for the interactive parts of pieces (`<lesson-shell>`, `<lesson-beat>`, `<audio-player>`, `<zita-chat>`).

**Worker.** A small Cloudflare program that runs in response to a request. Zeemish has two: the site worker (serves pages) and the agents worker (runs the daily pipeline).

**Wrangler.** Cloudflare's command-line tool for deploying Workers, applying database migrations, and managing Cloudflare resources from a terminal.

**Zita.** A Socratic learning helper embedded in every Zeemish piece. Asks readers questions rather than answering theirs. Reader conversations with Zita are logged and become one of the four signal sources for the learning loop.
