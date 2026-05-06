# The Daylila Book

*A beginner's guide to how this system works.*

---

This book is for someone who knows a little about computers and a little about programming, and wants to understand how a system like Daylila actually works — end to end, from the news arriving on a scheduled cron (default 02:00 UTC, admin-configurable) to the piece appearing on the site.

It's also for anyone who has heard the words "AI agent," "Cloudflare Worker," "GitHub," or "database" and wondered what they actually mean, and whether the explanations online are deliberately making them sound harder than they are. They are.

You don't need to finish this book to understand Daylila. Each chapter stands on its own. If you already know what GitHub is, skip that chapter. If you've never opened a terminal in your life, start at the beginning.

## Who wrote this

The first draft was written with Claude (Anthropic's assistant) during the week after Daylila launched, in the same style as the pieces Daylila itself publishes. Plain English. Short sentences. No jargon without immediate translation. Trust the reader.

## How to read

Start at `CONTENTS.md` for the table of contents and to see which chapters are written and which are outlines. If you want the shortest path to understanding Daylila specifically, read chapters 6, 7, 8, 9, and 10 — that's the core story. The earlier chapters give you the world the core story lives in.

## How to print

The book is plain markdown with Mermaid diagrams. To make a PDF:
1. Concatenate the numbered chapters in order.
2. Convert with `pandoc` or a similar tool that handles Mermaid.
3. A sample script lives in `scripts/build-book.sh` *(to be written — see WRITING-MORE.md)*.

## How to help this book grow

If you're Zishan working with Claude Code, see `WRITING-MORE.md` — it has instructions for expanding outline chapters into full ones in the same voice.

If you're a reader who found a mistake, open an issue on the repo. The book is versioned alongside the code, which means corrections are cheap and welcomed.
