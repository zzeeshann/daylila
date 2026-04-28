# 11 — The quality gates

*Status: outline. To be expanded by a future session — see WRITING-MORE.md.*

---

## What this chapter covers

- Why "let the AI write it and ship" doesn't work for a daily publishing system.
- The three gates in detail: Voice Auditor, Fact Checker, Structure Editor.
- What each one checks, what its pass/fail thresholds are, and why those thresholds.
- The Integrator pattern: take the feedback, revise, resubmit. Up to three rounds.
- Tier labels on published pieces — Polished (≥85), Solid (70–84), Rough (<70) — and why all of them ship.
- What happens when a gate consistently fails on a topic: the piece is not forced through. It escalates to a human.

## Why this matters for Zeemish

- The gates are what separates "autonomous publishing" from "spam engine." They are the thing that makes daily autonomous publishing safe enough to brand as a teaching system.
- Each gate is itself a Claude call with a specialised prompt. Keeping the writing call and the judging calls separate is deliberate — chapter 6 explains why.
- The Fact Checker's DDG limitation is covered here explicitly (and tracked in FOLLOWUPS).

## Key terms introduced

- quality gate, auditor, tier, revision round, escalation, human-in-the-loop fallback
