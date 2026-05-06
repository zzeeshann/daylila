# 11 — The quality gates

*Status: outline. To be expanded by a future session — see WRITING-MORE.md.*

---

## What this chapter covers

- Why "let the AI write it and ship" doesn't work for a daily publishing system.
- The three gates in detail: Voice Auditor, Fact Checker, Structure Editor.
- What each one checks, what its pass/fail thresholds are, and why those thresholds.
- The Integrator pattern: take the feedback, revise, resubmit. Up to three rounds.
- Tier labels on published pieces — Polished (≥85), Solid (70–84), Rough (<70) — and why all of them ship. Since 2026-05-06, the threshold values and the ship-anyway rule live in the audit contract (`content/audit-contract.md`) — pulled out of the code-side docstrings so the rules and their reasoning sit together in one place.
- What happens when a gate consistently fails on a topic: the piece is not forced through. It escalates to a human.

## Why this matters for Daylila

- The gates are what separates "autonomous publishing" from "spam engine." They are the thing that makes daily autonomous publishing safe enough to brand as a teaching system.
- Each gate is itself a Claude call with a specialised prompt. Keeping the writing call and the judging calls separate is deliberate — chapter 6 explains why.
- The Fact Checker now reaches the live web through Anthropic's `web_search_20250305` server tool (replaced DuckDuckGo Instant Answer 2026-04-30, after the J. Craig Venter piece exposed cutoff-confessing notes on a real death). The drawer surfaces each claim's status and note, plus a round-level "Sources consulted" line listing the unique domains Claude searched — chapter 9 has the full agent description.

## Key terms introduced

- quality gate, auditor, tier, revision round, escalation, human-in-the-loop fallback
