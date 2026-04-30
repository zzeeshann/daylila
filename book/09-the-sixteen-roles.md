# 09 — The sixteen roles

Chapter 6 explained what an agent is. Chapter 8 explained what Zeemish does. This chapter explains how the two fit together — the sixteen specific roles that make up Zeemish's daily pipeline.

A quick reminder from chapter 6: ten of these roles use Claude to make decisions. The other six are supporting code. Both kinds matter. Both kinds are called "agents" in the repo because they each have one clear job and live in one file. That's the only thing the word "agent" promises in Zeemish.

Here they are, in the order they run.

## 1. Scanner

**Job:** Fetch today's news headlines.

**What it does:** Reads six RSS feeds — Reuters, AP, BBC, Axios, a few others. Deduplicates stories that appear in multiple feeds. Stores the result in a table called `daily_candidates`. Typically produces around 50 candidate stories per run.

**Claude call?** No. Just code parsing XML from RSS feeds.

**Why this separation matters:** Scanner's job is boring but reliable. Keeping it free of Claude means Scanner always works, even if Anthropic's API has a bad day. You don't want your news fetcher depending on a language model.

## 2. Director

**Job:** Route work between agents. Keep the pipeline moving.

**What it does:** Director wakes up on a cron — default 02:00 UTC daily, admin-configurable via `admin_settings.interval_hours`. It calls Scanner. When Scanner finishes, it calls Curator. When Curator finishes, it calls Drafter. And so on. It is the conductor. It does not do any of the work itself.

**Claude call?** No. Zero. This is the explicit design — one pure orchestrator, no model calls, no judgment. Just routing.

**Why:** A router that makes judgments is harder to debug than a router that just passes messages. Keeping Director dumb-on-purpose makes the pipeline easier to reason about.

## 3. Curator

**Job:** Find the story whose underlying system best teaches the Zeemish protocol — and write the brief.

**What it does:** Reads all 50 candidates. Picks one. Writes a brief — a short document explaining what the story is, what the underlying system is, what angle the piece should take, and roughly what beats the piece should have.

**Claude call?** Yes. One call with the 50 candidates and a prompt that opens with the Zeemish protocol itself. Also sees the last 30 days of published headlines plus each one's underlying subject, so it can steer away from concepts the library just covered.

**What "teachable" means in Zeemish's prompt:** every story connects to a system. The job is to find the connection, not to gate-keep against pieces that don't pattern-match an institutional or supply-chain template. A murder case teaches human psychology and the systems of grief and justice. A celebrity scandal teaches influence dynamics, social proof, the economics of attention. A firing-squads policy teaches the philosophy of state violence and the design of execution methods. Curator's default is to PICK; skip is reserved for the narrow case where the news is genuinely a single breaking event being re-reported with no new angle, or a pure product spec with no underlying system. The earlier prompt had a "60+ teachability threshold" that read more strictly than intended — Claude treated it as a conservative floor and dismissed sensitive subjects as "culturally-specific" or "shallow." The 2026-04-25 reframe dropped the threshold and embedded the Zeemish protocol at the top of the Curator prompt, so Curator now picks through the same lens the auditors and Drafter already used.

The prompt's TEACHABILITY section carries fourteen worked examples — eight from the 2026-04-25 reframe (crime, celebrity/culture, supply chain, science, policy, business, tech announcement, death/loss/dignity), six added in the 2026-04-26 refinement (social conditioning, psychological/cognitive patterns standalone, environmental systems, money / ordinary life, health systems, technology / daily life). The list is a breadth-showing set, not a whitelist — Curator uses it as a way to *see* what stories are teaching, especially in categories news RSS feeds don't surface cleanly (a rent-setting story lands under BUSINESS; a diagnostic-reasoning story lands under HEALTH; a recommendation-algorithm story lands under TECHNOLOGY — the underlying systems are not always what the feed category suggests).

## 4. Drafter

**Job:** Write the piece.

**What it does:** Takes the brief from Curator. Loads the voice contract (the rules for how Zeemish writes). Loads the most recent learnings from past pieces. Produces a complete MDX file — the piece's text, formatted with beat headings, with frontmatter (title, date, beat count, tier, etc.).

**Claude call?** Yes. The biggest one in the pipeline — producing 1,000 to 1,500 words of polished prose takes the most model work.

**Note about the loop:** As of 2026-04-19, Drafter also has a second job — reflecting on its own piece after publication. That's handled by a separate method on the same file. Chapter 14 explains this in full.

## 5. Voice Auditor

**Job:** Check if the piece actually sounds like Zeemish.

**What it does:** Reads the draft. Checks it against the voice contract — no tribe words, plain English, short sentences, hospitality principle. Produces a score out of 100 and a list of specific violations if any. Passes if score ≥ 85.

**Claude call?** Yes. A different prompt than Drafter — this one is specifically for judgment, not writing.

**Why a separate agent?** Because the thing writing the piece is not the best thing to judge the piece. Separation of concerns. A different Claude call, with a different prompt focused only on voice, produces more reliable quality control than asking the same call to self-check.

## 6. Fact Checker

**Job:** Check that the claims in the piece are correct.

**What it does:** Extracts factual claims from the draft ("fuel rose 40%," "Spirit's margin is 4%," "QVC reached 96 million households"). Checks each one. Originally designed to use a web search tool for verification; in practice, most verification currently lands on Claude's own knowledge because the web search tool it uses (DuckDuckGo Instant Answer) only resolves about 5% of specific claims. A richer search backend is in the followups list.

**Claude call?** Yes. Plus a web search call that often returns nothing useful.

**Pass condition:** No claim is flagged `incorrect`. Unverified claims are allowed — see the honesty about the DDG limitation above.

## 7. Structure Editor

**Job:** Check the shape of the piece.

**What it does:** Reads the draft. Checks that the hook is one screen, the close is one sentence, there are 3–6 beats, the piece has frontmatter, the word count is in range, the flow makes sense. Flags specific structural issues.

**Claude call?** Yes. Another judgment call, focused on shape rather than voice or facts.

**What it doesn't check yet:** the "Watch" beat. The format spec says every piece should have a Watch beat — what to look for next — but Structure Editor doesn't currently gate on it. On the followups list.

## 8. Integrator

**Job:** Take the auditors' feedback and fix the piece.

**What it does:** If any of the three auditors failed, Integrator reads their feedback, rewrites the piece to address the issues, and sends the result back through the auditors. This can happen up to three times. If it still fails after three rounds, the piece escalates to a human (in practice, an observer event and a visible marker on the dashboard).

**Claude call?** Yes. Depending on how bad the draft was, one to three calls.

**Why three rounds:** arbitrary but practical. Most fixable pieces fix in one or two rounds. Anything needing more than three rounds probably has a deeper problem that a human should see.

## 9. Publisher

**Job:** Commit the finished piece to GitHub so it goes live.

**What it does:** Takes the approved MDX. Writes it to the right filename (`YYYY-MM-DD-slug.mdx`). Commits to GitHub. This triggers GitHub Actions, which deploys the site, which means the piece is live on `zeemish.io` within two minutes.

**Claude call?** No. Just GitHub API calls.

## 10. Audio Producer

**Job:** Narrate the piece, beat by beat, as audio.

**What it does:** Reads the published piece. For each beat (hook, teaching 1, teaching 2, etc.), calls ElevenLabs to generate an MP3. Uploads each MP3 to R2 (Cloudflare's object storage). Saves the URLs in D1.

**Claude call?** No. ElevenLabs is a different kind of AI, for voice synthesis.

**Why beat by beat:** A single long audio file is clumsier than per-beat clips. Per-beat audio can be navigated — listeners can skip to a specific beat. Also, per-beat clips let the audio pipeline resume from where it stopped if something breaks. Chapter 13 goes into the technical story.

## 11. Audio Auditor

**Job:** Check that the audio files are real and sized correctly.

**What it does:** Reads the audio records from D1. For each one, does a HEAD request to R2 — just checks "does this file exist, and is it the right size?" — without downloading the whole MP3. Flags missing or anomalously-sized files.

**Claude call?** No. Just R2 metadata checks.

**What it doesn't do:** Listen to the audio to verify it sounds right. That would require a speech-to-text pass, which is on the followups list.

## 12. Learner

**Job:** Write patterns to a `learnings` table so future pieces get better.

**What it does:** After each publish, reads the piece's full quality record — audit scores, revision rounds, which candidate Curator picked vs passed over, pipeline timing. Looks for patterns. Writes short observations to the `learnings` table with `source='producer'`.

When readers eventually arrive, the same Learner also reads reader engagement data (views, completions, drop-off points, audio play rate) and writes `source='reader'` patterns.

When Zita conversations accumulate, Learner also reads those and writes `source='zita'` patterns.

**Claude call?** Yes, one per signal source per run.

**How this closes the loop:** the `learnings` table gets read by the Drafter on the next piece (chapter 4 of this shift, chapter 14 of this book). So the system's self-knowledge flows back into the next piece's writing prompt. Chapter 14 explains this in full.

## 13. Categoriser

**Job:** Assign each just-published piece to 1–3 categories in the library's taxonomy.

**What it does:** After Publisher ships the piece, reads the final MDX plus the current list of categories from the database. Asks Claude which categories the piece belongs to. Writes the assignments to a `piece_categories` table and keeps a running count of how many pieces are in each category. When nothing in the existing list fits the piece cleanly, creates exactly one new category — never more than one per run.

**Claude call?** Yes. One per piece on the happy path. Up to two if the first attempt fails the rules (more on that below).

**Why the reuse bias is the whole point:** A library with a new category for every piece is a list of headlines, not a taxonomy. The prompt tells Claude directly: prefer reuse, and create a new category only when an existing one genuinely doesn't fit. The numeric anchors form a tiered choice. Above 75 confidence, the piece's *primary* underlying subject fits the existing category cleanly — pick it. Between 60 and 74, the fit is stretchy but the closest existing wins, with a reasoning sentence that names what's stretchy (a "thematic echo, not primary subject" rather than a clean match). Only when nothing fits even at 60 does Claude propose a new category — and only as a durable subject that could hold ten future pieces, never as today's news.

The effect compounds. Early pieces create the taxonomy because the list is short and doesn't cover every subject yet. Later pieces see a richer list and mostly reuse. The first nine pieces produced seven categories; the twentieth introduced "Knowledge Formation" (deep-sea biology mystery + the smell-maps piece sat in a science-of-perception cluster the existing taxonomy didn't cover). That's the shape a taxonomy takes when it's working — most pieces reuse, occasionally a piece earns a durable new node.

**Every piece lands somewhere — the zero answer doesn't exist.** An earlier version of the prompt left an opening for Claude to return an empty assignments array on the first piece (before the taxonomy had any rows yet). On 2026-04-28 the "Mystery of golden orb" piece exploited that opening months later — the existing taxonomy was trade/policy/violence-skewed, none of it fit a deep-sea biology mystery cleanly, Claude returned `{"assignments":[]}` and the piece quietly stayed untagged. The fix has three layers. The prompt now explicitly forbids the empty answer and lays out the tiered choice. The agent's resolver filters anything below 60 confidence (catches a separate prompt-violation bug from earlier in the month). If Claude does return empty on the first attempt, the agent fires one retry with a message that names the violation. And if even the retry returns empty — the piece is genuinely outside everything the system has yet learned to talk about — the agent writes one row to a reserved "Patterns Yet to Cluster" category that's hidden from readers and only visible to the operator as a warn-severity signal that the taxonomy needs another piece's worth of evolution. The reader-facing rule is absolute: every piece is filed under at least one category in the library.

**Why post-publish and not inline:** Categorisation doesn't gate publishing. A piece going live takes its categorisation as the next step; readers get it on `/daily/<date>/<slug>/` immediately, and the category appears a few seconds later. The category is metadata that adds a *browsing* surface — the library's chip bar — not a *correctness* surface. Running it off-pipeline, same shape as Learner and Drafter's self-reflection, keeps the publishing path short and fast while preserving the every-piece-must-have-one rule.

## 14. Interactive Generator

**Job:** Produce a standalone quiz that teaches the same underlying concept as the piece — without ever naming the piece.

**What it does:** After Publisher ships, re-reads the published MDX and writes a 3–5 question multiple-choice quiz about the *concept* the piece taught. Commits the quiz as its own JSON file in `content/interactives/`. The quiz gets its own URL at `/interactives/<slug>/` for direct linking, and (since Area 5's single-scroll layout) embeds inline at the bottom of the daily piece page so a reader who scrolls through the beats walks straight into it without clicking out.

**Claude call?** Yes. Up to three — each attempt is handed to the Interactive Auditor (the next agent). If the audit fails, Generator revises with the auditor's feedback and tries again. Three rounds maximum.

**Why "essence not reference":** If the quiz quizzed readers on the specific story (*what was the defendant's bet size?*, *which month did Schedule III reclassify?*), it would test memory of today's news, not understanding of the underlying pattern. The point of a quiz is to check whether a reader can recognise the concept somewhere else. So the quiz asks about the underlying shape — chokepoints, information asymmetry, cascades, legitimacy — not about the specific news event that made today's piece teachable. A stranger landing on the quiz's URL without having read the source piece should still find it useful.

**Why "Plain English" gets a second pass for quizzes (2026-04-29):** The voice contract has always said *"Plain English. No jargon without immediate translation."* For daily pieces that works — a 1,500-word piece has room to introduce a precise term and define it in the next sentence. A 4-option question on a single screen doesn't have that scaffolding budget. So the rule splits: the precise concept name lives in the quiz's `title` and `concept` line — that's where words like *asymmetry* and *chokepoint* are correct register. Every question stem, every option, every explanation uses everyday words a curious 14-year-old reads cleanly the first time. *"Why does asymmetry in outside options destabilize coordination agreements?"* — contract-compliant on the letter, but a teenager has to re-read twice. The same idea, rewritten: *"Why do deals fall apart when one side has more options to walk away?"* The quiz Generator now embeds the voice contract directly (it didn't before — that was the gap) plus a translation list of common concept-jargon to plain language. The Auditor enforces the same split. HTML interactive captions and tooltips follow the same rule; slider labels and axis units stay terse.

**What happens if it can't pass:** Three rounds exhausted without a clean pass, the quiz ships anyway with a `quality_flag='low'` marker. The "How this was made" drawer for the source piece names the rubric the auditor flagged ("essence-not-reference", "structure & pedagogy", and so on); admin UI marks the artefact FLAGGED LOW with a retry button. Better to ship a refined-but-imperfect artefact than a 404. Earlier copy on the drawer had borrowed the daily-piece "Rough" tier label and produced a contradiction the first time it surfaced — voice 88 (Polished tier, ≥85) sitting next to "Shipped as Rough" on the same line; replaced same-day with vocabulary that doesn't conflate two different rubrics.

**What happens when Claude misformats the response:** Once in a while, despite explicit "JSON only, no prose" instructions, Claude returns a response the parser can't read — a stray markdown fence, a leading "Here's the quiz:", a truncated body. The Generator now treats that the same way it treats an audit failure: the round is counted, the loop tries again. Three model misformats in a row would still need an operator retry (a separate failure mode from auditor max-fail; the piece doesn't ship as low because there's no artefact to ship). The system also forces Claude to start its response with `{` by prefilling the assistant turn — Anthropic's documented technique for nudging the model into JSON output. Quiz failure no longer blocks the HTML path either; if the quiz hits three misformats and the HTML succeeds, the HTML still ships and the operator can retry just the quiz.

**A second artefact type is on the way.** The v3 work commissioned 2026-04-26 extends Generator to produce a second artefact alongside the quiz: an HTML interactive — a single self-contained file that teaches the same concept by manipulation. A slider, a scrubbable timeline, two side-by-side configurations the reader can toggle between, a small simulation. Whatever shape Claude judges fits the concept. The HTML lives at `content/interactives/<slug>.html` next to the quiz JSON, gets rendered inside an iframe with `sandbox="allow-scripts"` (no other tokens), and ships per piece the same way the quiz does — both, always, like audio. The same produce → audit → revise loop runs for each. Same agent file, same Director hook, same observer-event surface. No new agents. The plan and spec live in [`docs/INTERACTIVES_PLAN.md`](../docs/INTERACTIVES_PLAN.md) and [`docs/INTERACTIVES.md`](../docs/INTERACTIVES.md); Phase 2 is when the HTML path actually ships.

## 15. Interactive Auditor

**Job:** Judge the quiz the Generator just produced.

**What it does:** Reads the quiz against four dimensions — voice, structure, essence-not-reference, factual — in a single Claude call. Returns pass/fail with per-dimension feedback. The Generator uses that feedback to revise.

The four dimensions:

- **Voice.** Same rules as the daily-piece voice contract, adapted to quiz register. Questions read the same as teaching prose. No flattery. Since 2026-04-29, the auditor enforces a Plain English split rule on top of the contract — concept-jargon (asymmetry, coordination, mitigation, throughput, restraint, structural, mechanism, etc.) is correct in the quiz's `title` and `concept` line, but flagged when it appears inside a stem, option, or explanation; the 14-year-old test is the scoring anchor.
- **Structure.** 3–5 questions. Plausible wrong options. No "all of the above". Explanations that unpack both the right answer and why the tempting wrong one falls short.
- **Essence.** The primary bar. The quiz must not name specifics — no proper nouns, no dates, no quoted phrases. Concept overlap is the goal; detail leaks are the violation. The rule had to be carefully loosened after the first real run: same-concept testing is *the goal*, not a violation; the auditor was briefly catching that as an essence leak and failing good quizzes.
- **Factual.** External-world claims must be true as general statements. No web search here — evaluates against Claude's general knowledge, flags uncertain claims as issues.

**Claude call?** Yes. One call per round, covering all four dimensions together.

**Why one auditor instead of four:** A quiz is small — maybe 300 words total. The three separate auditors that gate a daily piece exist because a 1,500-word MDX file is complex enough to benefit from parallel specialised judgment. A 300-word quiz isn't. One coherent pass is both cheaper (roughly four times fewer API calls) and more consistent than four parallel ones that might contradict each other.

**What gets persisted:** The Generator's loop writes one row to `interactive_audit_results` per round per dimension — voice/structure/essence/factual × up to three rounds, so up to twelve rows per quiz. The shape mirrors the daily-piece `audit_results` table, with `passed`, `score` (voice only), and `notes` (the auditor's per-dimension violations and suggestions). Latest-round data drives the drawer's named-rubric copy on shipped-low artefacts; the rest is the forensic record a future admin per-quiz page will read.

**Same auditor, same four dimensions, second artefact type incoming.** When the v3 HTML interactive path ships in Phase 2, this auditor extends to judge HTML files alongside quizzes. The four dimensions stay the same in name — voice, structure, essence-not-reference, factual — but the questions adapt: voice judges in-iframe copy (labels, captions, button text); structure judges whether the HTML renders as one cohesive teaching artefact with a clear interactive surface; essence judges whether *manipulating* the interactive teaches the concept (a slider that doesn't change anything mechanism-relevant is decorative, not teaching); factual judges any embedded numbers and ranges. All four dimensions move from binary pass/fail to a 0–100 score with a threshold (voice ≥85, the others ≥75) — an HTML interactive is multi-dimensional in ways a 3-question quiz isn't, and binary judgement is too coarse for shapes that can be 80% useful. The persistence shape doesn't change; rows still land in `interactive_audit_results`. Full rubric in [`docs/INTERACTIVES.md`](../docs/INTERACTIVES.md).

## 16. Observer

**Job:** Log every pipeline event.

**What it does:** Every time any other agent does anything notable — started, finished, escalated, failed — it sends an event to Observer. Observer writes the event to the `observer_events` table. The dashboard reads from this table to show what's happening now and what went wrong recently.

**Claude call?** No. Just logging.

**Why this matters:** Without Observer, nothing on the dashboard works. The transparency promise of Zeemish — that every piece has a "how this was made" drawer — depends on Observer having logged the relevant events at the time they happened.

## Plus one more thing

Chapter 14 will explain that Drafter has a second, separate role — reflecting on each piece after publication. This is not a seventeenth agent. It's a second method on the existing Drafter file, called post-publish, writing to `learnings` with `source='self-reflection'`.

The reason Drafter does this rather than a new agent is simple: the thing that wrote the piece is the right thing to reflect on the piece. Reflection is not a new voice; it's the same voice, now looking back. One file, two jobs.

## If you remember one thing from this chapter

The sixteen roles are the scaffolding. The scaffolding exists so each role can be small, focused, and changeable. The work happens inside the roles. The framing — "16 agents" — is a way of organising code, not a claim about collective intelligence.

The interesting thing isn't that there are sixteen of them. The interesting thing is what comes out the other end every morning.
