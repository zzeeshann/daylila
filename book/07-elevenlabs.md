# 07 — ElevenLabs and voice synthesis

*Status: outline. To be expanded by a future session — see WRITING-MORE.md.*

---

## What this chapter covers

- The difference between text-to-speech (what your phone does when it reads a message aloud) and modern voice synthesis.
- How modern voice synthesis works: trained on recordings of a real voice, can say things that voice never said.
- ElevenLabs specifically — a company that made this technology available via a web API.
- The voice Daylila uses: Frederick Surrey. Why it was chosen and locked.
- Per-beat narration: why Daylila generates audio one beat at a time rather than one file for the whole piece.
- The ethics and limits of voice synthesis — consent, cloning, deepfakes.

## Why this matters for Daylila

- Every daily piece has audio narration so readers can listen, not just read.
- Audio generation is slow (10–15 seconds per beat). The audio pipeline runs separately from the text publish so the day isn't held up.
- Chapter 13 covers the audio pipeline's technical details; this chapter is about the voice layer itself.

## Key terms introduced

- text-to-speech, voice synthesis, voice cloning, API, per-beat narration, prosodic continuity
