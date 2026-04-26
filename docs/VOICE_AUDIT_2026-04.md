# Voice contract audit — 2026-04

**What:** A close read of `content/voice-contract.md` against the last five published pieces, looking for systematic drift.

**Why:** The pipeline ships clean pieces and voice scores hover ≥85, but reading the pieces side by side surfaces three patterns the contract doesn't catch — patterns that bend the writing toward "explain first" when the contract calls for "observe first". This audit names the patterns, quotes them verbatim, and shows the rewrite. It also surfaces a stale rule in the contract itself.

**Scope:** 2026-04-24 (FISA, Soldier-betting), 2026-04-25 (Maine data centres), 2026-04-26 (Palestine elections, Chernobyl). Banned-words check across all five: clean. Zero hits on journey, empower, transform, unlock, embrace, dive, wellness, mindfulness.

---

## Pattern 1 — Summary-first hooks

### What's happening

Every piece in the sample has at least one. The hook explains the situation in two or three sentences before the question lands. Voice contract says:

> Hook: One screen of text. A question, statistic, or statement that creates curiosity. No "In this lesson, we'll learn about..." — ever.

The drift is subtler than that ban. The hook is technically a question — but it arrives after a paragraph of explanation that's already done the curiosity work. The reader doesn't get pulled in; they get briefed.

### Verbatim examples

**Palestine elections** (2026-04-26):
> *In parts of the West Bank and some areas of Gaza, Palestinians voted in local elections yesterday. The Palestinian Authority organized the vote. Hamas didn't participate. Israel controls movement, borders, and much of the territory where voting happened. So what does an election mean when the basic question of who governs remains unsettled?*

The question only arrives in sentence five. By the time the reader gets there, four sentences of context have already framed the answer.

**Maine data centres** (2026-04-25):
> *Maine Governor Janet Mills vetoed a bill that would have banned new data center construction in the state. The proposed ban emerged because these facilities — the physical backbone of cloud computing, streaming services, and AI — consume massive amounts of electricity and water, straining local grids that weren't built for them.*

The hook explains the problem before asking anything.

**FISA reauthorization** (2026-04-24):
> *Mike Johnson has now brought the FISA reauthorization bill — a renewal of certain U.S. surveillance powers — to the House floor three times. It has failed twice.*

Statement-first, no question.

### What the fix looks like

Open with the observation that creates a question in the reader's head — and let the question follow. The Chernobyl piece (2026-04-26) does this cleanly:

> *Wildlife thrives in Chernobyl's exclusion zone. Wolves, wild boar, deer, elk, eagles — populations that have exploded in the decades since humans evacuated. Walk through the abandoned villages and you'll see more large mammals than in most European nature reserves. But the BBC's recent report on Chernobyl wildlife research reveals something unsettling: these animals aren't immune to radiation. They show elevated mutation rates, DNA damage, cellular stress, and shortened lifespans …*
>
> *So what does "thriving" actually mean when the environment itself is poisoned?*

The hook describes what the reader can see (thriving wildlife), then the surprise (they're not immune), then the question. The reader is *inside* the puzzle by the time the question arrives.

**Rewrite of the Palestine hook in the same shape:**

> *Yesterday, Palestinians stood in line at polling stations in parts of the West Bank to vote for local councils. In Gaza, most polling stations stayed shut. Israeli checkpoints decided who could reach which station. The Palestinian Authority counted ballots; Hamas counted nothing.*
>
> *So what is an election doing when three different actors control different parts of the same vote?*

Same facts. The reader is asking the question with the writer, not being handed it.

---

## Pattern 2 — Explanatory teaching opens

### What's happening

Teaching beat #1 typically opens with a definition or principle: "X is …", "When X happens, Y …". That's didactic — it states the lesson, then illustrates. The voice the contract wants is observational — a specific fact, a concrete moment, then the principle that the fact reveals.

### Verbatim examples

**Palestine elections**, teaching beat 1:
> *Elections aren't just vote-counting mechanisms. They're legitimacy rituals. When a government holds an election, it signals: I control the infrastructure of governance.*

Definition first, principle second, no observation anchoring it.

**Chernobyl**, teaching beat 1:
> *Adaptation under constraint is about trade-offs, not invulnerability.*

Single-sentence statement of the principle as the opener. Beat 2 of the same piece does the right thing — it opens with "The animals in Chernobyl can't eliminate radiation damage. Ionizing radiation breaks DNA strands…" — concrete observation, principle follows.

**Soldier-betting** (2026-04-24), teaching beat 1:
> *Prediction markets are platforms where people bet real money on real-world events.*

Definition open. Reader is being lectured, not shown.

### What the fix looks like

Open with the specific. Let the principle emerge from it. The Chernobyl piece's beat 2 already does this; beat 1 should match.

**Rewrite of the Palestine teaching-1 in observe-first shape:**

> *In Tunisia, the polling station stays open even when no one's there to vote. In Belarus, security agents read the ballots before the count. The mechanics — staffing, printing, counting, certifying — aren't the boring part of an election. They're the signal. Whoever can run the procedure is the one claiming to govern.*

Three concrete pictures, then the principle. The principle lands harder because the pictures earned it.

---

## Pattern 3 — Over-explaining closes

### What's happening

Voice contract is explicit:

> Close: One sentence. No summary. No call to action. No congratulations. Lands like the last line of a short story — it just sits there.

When closes drift, they drift into multi-sentence summaries that re-state the lesson the teaching beats already delivered. This is the most occasional of the three patterns — but where it happens, it deflates the piece.

### Verbatim example

**Palestine elections**, close (the entire close beat):
> *Yesterday's vote didn't settle who governs. It signaled who claims the authority to organize governance rituals — and who recognizes that claim. Elections in contested spaces are never just about outcomes. They're about the infrastructure of legitimacy: who can hold them, who participates, who accepts the results. Legitimacy is built through repeated signals, not single events. The ritual matters because it says: this is what governance looks like here, and I am the one making it happen.*

Six sentences. Three of them re-state the principle the teaching already taught.

### What the fix looks like

The Chernobyl close (one sentence, lands):
> *Chernobyl's wildlife teaches that resilience isn't about being unharmed — it's about finding ways to persist when harm is unavoidable.*

**Rewrite of the Palestine close in the same shape:**

> *The vote was the claim, not the answer.*

That's it. The teaching beats already taught the reader why. The close gives them somewhere to land.

---

## A separate finding — the contract has a stale word-count rule

`content/voice-contract.md` line 34 says:

> *Teaching: One idea per beat. Start from the reader's own experience, build outward. 1500–2500 words across all teaching beats.*

The Drafter prompt says:

> *1000-1500 words across all beats.*

These contradict (the teaching alone can't exceed the total). Production is publishing 728–1,488 word pieces — the Drafter prompt is winning, the voice contract line is stale (almost certainly carried over from the lessons era when teaching beats were longer).

Action 1 fixes this alongside the three drift-pattern updates: voice contract Teaching rule aligned to the Drafter's range, no contradiction.

---

## Recommendations

The drifts are systematic, not one-off. Two changes ship in the same commit as this audit:

1. **`content/voice-contract.md`** (and its mirror `agents/src/shared/voice-contract.ts`) — sharpen the Hook rule ("observe and ask, never summarise and explain"), sharpen the Teaching rule ("open with a specific observation; the principle follows"), fix the stale word-count rule.
2. **`agents/src/drafter-prompt.ts`** — same three rules embedded directly in the Drafter prompt's bullet list, so the writer sees them at draft time, not just at audit time.

This audit doc itself is the artefact. It also lands as a producer-source learnings entry so the next Drafter run sees it in `getRecentLearnings`.

## Closing test

The next 02:00 / 14:00 UTC pipeline run is the verification. The new piece should:
- Open the hook with an observation that creates the question, not an explanation.
- Open teaching beat #1 with a specific fact, not a definition.
- Close in one sentence that sits.

If those three land, the prompt change worked. If not, the drift is deeper than the prompt and the Voice Auditor needs a corresponding tightening — separate work.
