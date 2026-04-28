# 99 — Glossary

Every term this book uses, in plain English. If you see a word you don't recognise anywhere in the book, it should be defined here. Alphabetical.

---

**Agent.** A program that uses a language model to make one or more decisions, then acts on those decisions. In Zeemish's code, "agent" is also the name given to sixteen specific files that each handle one role in the pipeline — some use Claude (like Curator, Drafter, Categoriser, Interactive Generator), some don't (like Scanner, Publisher). See chapter 6.

**Alarm.** A scheduled callback in Cloudflare's Durable Object system. A Durable Object can tell itself "run this method N seconds from now," and the system will fire it in a fresh invocation with its own time budget. Zeemish uses alarms to run the audio pipeline, Learner, and Drafter self-reflection without blocking the main request.

**Astro.** The framework Zeemish uses to build the website. Takes MDX files and turns them into HTML pages. Supports "static site generation" (building the pages once, serving the built files) and "server-side rendering" (building pages on demand).

**Auditor.** An agent whose job is to judge quality. Voice Auditor, Fact Checker, and Structure Editor are Zeemish's three auditors. See chapter 11.

**Beat.** One section of a Zeemish piece. Typically a piece has 4–6 beats: Hook, Teaching (2–3 beats), Watch, Close. Each beat is its own MDX `##` heading and gets its own audio clip.

**Claude.** A specific AI language model made by Anthropic. Zeemish uses the Sonnet 4.5 version. See chapter 5.

**Claude Code.** Anthropic's command-line tool for delegating coding tasks to Claude. Different from "Claude" the chat assistant — same underlying model, different interface designed for editing repos.

**Cloudflare.** The company that runs Zeemish's code. A global network of data centres that runs small programs (Workers) close to users. See chapter 3.

**Commit.** A saved snapshot of a change in Git, with a message explaining what changed.

**Cron.** A scheduled task that runs at a set time. Zeemish's pipeline runs on an hourly cron gated by `admin_settings.interval_hours` — at the default (24) only the 02:00 UTC slot fires, so in practice it's once a day.

**D1.** Cloudflare's relational database service. Based on SQLite. Zeemish uses it for structured data (pieces, audit results, learnings, users). See chapter 4.

**Durable Object.** A special kind of Cloudflare Worker that has persistent state and lives in one specific location. Can remember things between calls. Zeemish's sixteen agents are each implemented as a Durable Object.

**ElevenLabs.** The voice-synthesis service Zeemish uses to turn piece text into audio narration. See chapter 7.

**Frontmatter.** Metadata at the top of an MDX file, between two `---` lines. Contains things like the piece's title, date, voice score, and audio URLs.

**Git.** A system for tracking every version of every file in a project. Works locally without the internet. GitHub is a website that hosts Git projects.

**GitHub.** A website owned by Microsoft that hosts Git projects. Zeemish's code lives at `github.com/zzeeshann/zeemish-v2`. See chapter 2.

**GitHub Actions.** GitHub's built-in system for automatically running tasks when something happens in a repo. Zeemish uses it to deploy both workers to Cloudflare on every push to main.

**Hallucination.** When a language model confidently produces text that is factually incorrect. Inherent to how LLMs work, not a bug that will be fixed.

**HTTP / HTTPS.** The protocol browsers use to talk to websites. HTTPS is the encrypted version, used everywhere today.

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

**Tier.** The label Zeemish attaches to each published piece based on its final voice score. `Polished` (≥85), `Solid` (70–84), `Rough` (<70).

**Voice contract.** The versioned document in the Zeemish repo that defines how the publication writes. Plain English, no tribe words, short sentences, hospitality principle. Lives at `content/voice-contract.md`. Loaded into the Drafter's prompt every time.

**Web Component.** A standard browser feature for building reusable UI elements with custom HTML tags. Zeemish uses Web Components for the interactive parts of pieces (`<lesson-shell>`, `<lesson-beat>`, `<audio-player>`, `<zita-chat>`).

**Worker.** A small Cloudflare program that runs in response to a request. Zeemish has two: the site worker (serves pages) and the agents worker (runs the daily pipeline).

**Wrangler.** Cloudflare's command-line tool for deploying Workers, applying database migrations, and managing Cloudflare resources from a terminal.

**Zita.** A Socratic learning helper embedded in every Zeemish piece. Asks readers questions rather than answering theirs. Reader conversations with Zita are logged and become one of the four signal sources for the learning loop.
