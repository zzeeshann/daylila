# The Zeemish voice system

How Zeemish writes. Where the rules live. How to change them.

This doc is for an operator who wants to understand or modify Zeemish's voice. If you've never touched it, read **What it is** and **How to change the voice** — that's enough. If you're planning the future admin voice-selector, read everything.

---

## What it is

Zeemish's voice is defined in two layers:

### Layer 1 — The Doctrine

The deeper standard. Names the writing posture: drop the reader into something already happening, find a specific person or moment, let contradictions stand without resolving them, end on an image not a moral, never write *"this matters because"*.

- Canonical file: [`content/ZEEMISH_MANTO_VOICE.md`](../content/ZEEMISH_MANTO_VOICE.md)
- Runtime mirror: [`agents/src/shared/voice-doctrine.ts`](../agents/src/shared/voice-doctrine.ts) (exports `VOICE_DOCTRINE`)

The doctrine is read by the Drafter at the start of every piece. The Voice Auditor judges every piece against it. The Integrator obeys it when revising.

**The doctrine's contents currently express the standard through Saadat Hasan Manto's posture** — Manto was the Urdu short-story writer (1912–1955) whose discipline of precise, unsentimental observation is what we want Zeemish to sound like. The principle the doctrine encodes is not "write like Manto" — it is *clear teaching, not robotic prose*. If a future operator decides a different writer's discipline expresses the standard better (Chekhov, de Maupassant, the operator's own voice), the contents of the .md can change. The architecture stays.

### Layer 2 — The Operational Contract

The polish layer. Names the mechanical rules: tribe-word ban list, length targets (1000–1500 words, 5–6 beats), the editor's read-aloud test, no flattery, plain English.

- Canonical file: [`content/voice-contract.md`](../content/voice-contract.md)
- Runtime mirror: [`agents/src/shared/voice-contract.ts`](../agents/src/shared/voice-contract.ts) (exports `VOICE_CONTRACT`)

The contract is loaded into the Drafter's user-message at runtime, embedded in the Voice Auditor's system prompt, and inherited by the Integrator + Interactive Auditor + Interactive Generator via the same `VOICE_CONTRACT` import.

### How they relate

If they conflict, **the doctrine wins**. The contract is polish; the doctrine is the bar. A piece can pass every contract check and still fail the doctrine (the cartel-gold piece on 2026-04-26 scored 95 on voice but read like a report being read into a microphone — the failure that triggered this whole architecture).

---

## Files and where they live

| File | Purpose | Loaded by |
|---|---|---|
| `content/ZEEMISH_MANTO_VOICE.md` | The doctrine — human-readable canonical | Operators editing |
| `agents/src/shared/voice-doctrine.ts` | The doctrine — runtime constant | Drafter, Voice Auditor, Integrator |
| `content/voice-contract.md` | The contract — human-readable canonical | Operators editing |
| `agents/src/shared/voice-contract.ts` | The contract — runtime constant | Drafter, Voice Auditor, Integrator, Interactive Generator, Interactive Auditor |

The .md files are the source of truth for humans. The .ts files are the source of truth for the agents at runtime. **They must stay in sync** — the comment header on each .ts file says "If you update one, update the other." There's no automatic sync; it's a discipline.

---

## How a piece is judged

A piece flows through the pipeline like this:

1. **Drafter** loads `VOICE_DOCTRINE` into its system prompt as posture, plus `VOICE_CONTRACT` into the user message as polish, then writes the MDX against today's brief.
2. **Voice Auditor** loads both `VOICE_DOCTRINE` and `VOICE_CONTRACT` into its system prompt and judges the draft against:
   - **The microphone test (posture):** *Does this read like a person who has understood something telling another person what they found, or like a report being read into a microphone?*
   - **The named doctrine moves:** title literal vs. performative; hook arrives vs. summarises; close is ONE sentence; observation rhythm vs. dramatic rhythm; no "this matters because"; active voice names the actor; no "complex" as hand-wave; Watch beat instructs vs. predicts; contradictions held vs. resolved; specific anchor present vs. abstraction-only.
   - **The contract violations on top:** tribe words, flattery, jargon without translation, padding.
3. The Auditor returns a score 0–100. The piece passes at ≥85.
4. If it fails, **Integrator** revises against the auditor's named violations — but its prompt warns explicitly: *do not tame Manto-style writing in the name of polish*. Short sentences, unresolved contradictions, sitting closes are all correct.
5. Up to 3 revision rounds. After that, ship-as-low-quality (`qualityFlag='low'`).

The score reflects posture first, named moves second, contract third. A piece nailing the posture but with one tribe word scores in the high 80s. A piece reading like a report but with zero contract violations scores below 85.

---

## How to change the voice (current architecture)

There are three kinds of changes. Each has a clear path.

### A. Tighten or loosen a specific rule (most common)

You read a published piece and notice a recurring failure mode the auditor isn't catching. Or you want to relax a rule that's hurting good writing.

**What to do:**
1. Edit `content/ZEEMISH_MANTO_VOICE.md` — add the new rule or revise the existing one. Keep the prose-explanatory style (the doctrine teaches, it doesn't list).
2. Mirror the change into `agents/src/shared/voice-doctrine.ts` — the `VOICE_DOCTRINE` template literal must match.
3. If the rule is a specific named move the auditor should catch, also update `agents/src/voice-auditor-prompt.ts` to add the named move under the *"named moves to check"* list. Without this the auditor might pass the new rule on the literal reading.
4. Optionally extend `agents/src/drafter-prompt.ts` with a *"What the doctrine doesn't say but you need to know"* paragraph that names the rule operationally — useful when the doctrine prose is too literary to act on directly.

**Verify:**
- `cd agents && npx tsc --noEmit` — typecheck (ignore pre-existing server.ts SubAgent errors).
- Run [`agents/scripts/verify-doctrine.mjs`](../agents/scripts/verify-doctrine.mjs) with `ANTHROPIC_API_KEY` exported. Reads the prompts as text from source, runs them against a stored brief, prints the MDX. ~$0.05 per call. Read the output for the rule landing.
- Or just deploy and watch the next 2–3 cron firings.

### B. Replace the doctrine wholesale

You decide the Manto framing isn't working. You want a different writer's discipline (Chekhov, de Maupassant, an operator-original framing) to be the standard.

**What to do:**
1. Replace the contents of `content/ZEEMISH_MANTO_VOICE.md` with the new long-form posture document. Keep the file name — the import path references it.
2. Replace the template-literal contents of `agents/src/shared/voice-doctrine.ts` to mirror.
3. Don't rename the constant. `VOICE_DOCTRINE` is intentionally generic so the prompts that say *"the Zeemish voice doctrine"* don't need to change.

**Verify:** Same as A, but allocate a longer observation window — a full doctrine swap is a big change. Watch 5–7 cron firings before deciding it's stable.

### C. Adjust the operational contract

You want to add a new tribe word, change the length target, or relax the read-aloud test.

**What to do:**
1. Edit `content/voice-contract.md`.
2. Mirror into `agents/src/shared/voice-contract.ts` (`VOICE_CONTRACT` template literal).
3. The contract auto-propagates into Drafter, Voice Auditor, Integrator, Interactive Generator, and Interactive Auditor — no other changes needed.

**Verify:** typecheck + a single cron run.

---

## How to verify a change before it goes live

Three options, in order of cost and confidence:

### 1. Local prompt eyeball (free, ~30 seconds)

Read the new prompt yourself. Does it make sense? Are the instructions clear? Did anything contradict an earlier rule? If you're tightening a rule, did the surrounding rules still make sense after the tightening?

### 2. Direct API call (~$0.05, ~30 seconds)

```
cd agents
ANTHROPIC_API_KEY=sk-ant-... node scripts/verify-doctrine.mjs
```

The script reads the new prompts from source, runs them against a stored brief (the 2026-04-26 cartel-gold piece), and prints the MDX. Read it side-by-side with what shipped. The script is a one-shot — extend it if you want to verify against a different brief.

### 3. Live cron (~$2 per piece, ~10 minutes from trigger to publish)

Deploy and either wait for the next 02:00 / 14:00 UTC cron, or hit the admin trigger. Watch the published piece. Verify the rule landed.

For minor tightenings, option 1 + 3 is fine. For wholesale rewrites, do all three.

---

## The future: admin voice selection

The architecture supports voice selection at admin level when we want it. The shape (planned, not yet built):

### Schema

```sql
ALTER TABLE admin_settings
  -- existing key/value rows: interval_hours, interactives_html_enabled, etc.
  -- add a new row: voice_doctrine_slug = 'manto' (default).
```

### Doctrine registry

A new directory `content/voices/` holds one .md per available voice:

```
content/voices/
  manto.md          (current — currently at content/ZEEMISH_MANTO_VOICE.md)
  chekhov.md        (future — example second voice)
  operator.md       (future — operator's own framing)
```

A new file `agents/src/shared/voice-registry.ts` exports a map:

```ts
export const VOICE_DOCTRINES: Record<string, string> = {
  manto: MANTO_DOCTRINE,
  chekhov: CHEKHOV_DOCTRINE,
  operator: OPERATOR_DOCTRINE,
};
```

### Runtime resolution

The Drafter and Voice Auditor read `admin_settings.voice_doctrine_slug` at the top of each invocation, look up the matching doctrine in the registry, and pass it to the prompt builder. Default `'manto'` if the row is missing or the slug doesn't resolve (fail-safe — the system never runs without a doctrine).

### Admin UI

A new dropdown on `/dashboard/admin/settings/` alongside the cadence selector. Options populated from `VOICE_DOCTRINES` keys. Switching the doctrine fires an `admin_settings_changed` observer event with `before` / `after` slugs for audit trail.

### What this enables

- Try a doctrine on staging without committing — flip the slug, watch the next piece.
- A/B different doctrines across days.
- Per-section doctrine eventually (e.g., long-form pieces use one, opinion pieces use another).

### Why it isn't built yet

YAGNI. Today the system has one voice; building a selector before there's a second one is design-for-hypothetical. The constant is named `VOICE_DOCTRINE` (not `MANTO_VOICE`) and the prompts reference *"the Zeemish voice doctrine"* (not "Manto") so the architecture can absorb the change without rewriting prompt text — but the registry + admin UI + schema land when there's a second doctrine to choose between.

---

## History

**2026-04-19 — `VOICE_CONTRACT` (operational layer only).** Single-layer voice system: tribe words, length, plain English. Rules were mechanical. Worked for the early months.

**2026-04-26 — Voice contract Action 1 reset.** Refinement session named three voice-drift patterns (consultancy nominalisation, Western-policy-blog cadence, generic concept words masquerading as ideas) and reset the Drafter prompt + voice contract to address them. Single layer still — the contract was the standard. Voice scores stayed in the 85–95 band but the writing began to read uniform across pieces.

**2026-04-27 (early evening) — Doctrine layered onto the contract.** Operator review flagged the writing as robotic. The 2026-04-26 cartel-gold piece scored 95 on voice but read like a report being read into a microphone. The mechanical contract couldn't see posture failure. Operator handed over the Manto doctrine. New architecture: doctrine over contract, doctrine wins on conflict. Drafter prompt rewritten around posture. Voice Auditor rewritten around the microphone test.

**2026-04-27 (later) — Iteration 1.** First piece under the new architecture (`/daily/2026-04-27/supreme-court-reviews-police-use-of-cell-location-data-to-fi/`) shipped at voice 92. Posture mostly landed but two failures surfaced: title was performative (*"The Tower Pinged. You're on the List."* — thriller-headline shape, multiple sentences) and close was four sentences (rhetorical anaphora — *"Your phone is still pinging. The towers are still logging. The database is still growing."*). Drafter prompt extended with literal-title rule and observation-vs-dramatic-rhythm distinction. Voice Auditor tightened: multi-sentence close = automatic fail; rhetorical-pump rhythm = named violation.

The doctrine evolves the way the system evolves. Incrementally. Honestly. Each tightening backed by an actual published-piece failure, not a theoretical one.

---

## Related docs

- [`docs/AGENTS.md`](./AGENTS.md) — Drafter, Voice Auditor, Integrator agent paragraphs.
- [`docs/DECISIONS.md`](./DECISIONS.md) — append-only log; the 2026-04-27 entries cover the doctrine architecture and Iteration 1.
- [`docs/RUNBOOK.md`](./RUNBOOK.md) — operational procedures including how to change the voice.
- [`book/00.5-the-four-words.md`](../book/00.5-the-four-words.md) — the soul chapter; humbleness, quietness, calmness, consciousness.
- [`book/08.5-the-voice-doctrine.md`](../book/08.5-the-voice-doctrine.md) — the book chapter on the doctrine for the human reader.
