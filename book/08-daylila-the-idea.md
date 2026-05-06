# 08 — The idea

The news is a firehose. Every day, events happen that matter to you even though they seem far away. The dollar strengthened against the yen. An airline cancelled regional routes. A law passed in Delhi affecting chip manufacturing in Taiwan affecting the phone in your pocket.

You know, vaguely, that these things connect to your life. You don't have time to figure out how. So you either read headlines and feel more anxious without feeling more informed, or you stop reading the news altogether and feel uneasy that you're not paying attention.

Daylila is an attempt at a third option.

## What Daylila does

Every day, Daylila publishes. Each piece is around 1,000 to 1,500 words and takes about seven minutes to read. It uses today's news as a starting point — but the starting point is not the subject. The subject is always the underlying system. How many pieces per day is an admin setting (the default is one at 02:00 UTC; at the time of writing, it's two — at 02:00 and 14:00 UTC).

The QVC piece was a news story about a bankruptcy. The actual subject was why successful incumbents fail to adapt when a market shifts.

The Strait of Hormuz piece was a news story about oil prices reacting to a ceasefire announcement. The actual subject was chokepoints — geographic bottlenecks where whole systems concentrate and become vulnerable.

The airline piece was a news story about Spirit cutting routes. The actual subject was what happens when industries optimise for efficiency and then get hit by a shock.

In each case, the news is the hook — the thing that makes you start reading. The teaching is the substance — the thing you carry with you after you've forgotten the headline.

## Who Daylila is for

Adults who know something is going on in the world — with AI, with money, with power, with systems — and want to actually understand it. Not experts. Not students cramming for exams. Ordinary people who want ten minutes a day of clarity.

Willing to do the work of reading.
Not willing to wade through jargon, tribes, or self-help language.
Trusting that they're being written for, not written down to.

The hospitality principle stated earlier in this book applies here in full. A Hindu grandmother in Delhi, a Muslim teenager in Bradford, an atheist programmer in Berlin, a Catholic nurse in Manila — they should all read the same piece and feel it was written for them.

This is not a small ambition. It shapes every other decision.

## Why one piece a day

Because a habit is more valuable than a library.

If Daylila published twenty pieces a day, readers would pick and skim. They'd feel behind. The pile would never shrink. Instead of a practice, it would become a demand.

One a day is something a person can finish. Ten minutes. Read on the train, read over breakfast, listen while walking the dog. Tomorrow there's a new one. If you miss today's, the library keeps it — but tomorrow isn't blocked.

The format is deliberately tight. 1,000–1,500 words. No more. If the subject is bigger than that, Daylila splits it across days or picks a facet. The discipline matters.

## Why autonomous

A daily publication needs someone writing it daily. Most newspapers have hundreds of journalists. A one-person operation producing something this consistent would burn out in a month. Daylila doesn't want to be a burnout machine.

Instead, Daylila uses a system of AI agents to do the daily production work. Scanner reads the news. Curator picks the story. Drafter writes the piece. Auditors check it. Publisher ships it. This runs on a cron set in admin settings — by default, once a day at 02:00 UTC — without a human involved.

This is the "agents" side of Daylila. It is not the interesting part, ultimately. It's just how the daily piece gets made. The interesting part is that a daily piece exists at all, and that it's genuinely useful.

"No human in the loop" means no human in the *production* loop. Humans — Zishan, plus anyone reading this book — are very much in the *design* loop. The system doesn't decide what Daylila is. It just does the work of producing what Daylila has been decided to be.

## What Daylila is not

It is not a news site. It doesn't report on what happened. It starts from what happened and goes somewhere else.

It is not a course platform. There's no curriculum, no progression, no certificates. Each piece stands alone, though over time they connect.

It is not a blog with strong opinions. Daylila tries to explain systems, not advocate for positions. When it has to take a stance (for example, "efficiency creates brittleness is a pattern that repeats"), it backs the stance with examples and lets the reader decide.

It is not a chat assistant. There is a Socratic helper called Zita embedded in each piece, but Zita's job is to ask questions, not to give answers. Zita is there to prompt thinking, not to replace it.

It is not a product trying to go viral. The visible audit history on every piece, the audit gates, the slow daily rhythm — all of these are designed for a reader who wants to understand the world, not for a growth funnel.

## The protocol

The project has what Zishan calls a protocol, stated at the top of the repo:

*"Educate myself for humble decisions."*

*"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."*

*Everything that follows is an attempt to show you what that means — and how to do it.*

The framing is personal — *myself*. Daylila does not exist to educate *you*, the vague everybody. It exists so that each person who shows up, including the person who built it, can quietly learn enough to make better decisions at their own scale. The ambitions of this project are deliberately modest: not to change the world, but to add one daily reading to the lives of people who want it.

The second sentence is what the agents are actually trying to do — read the news through the lens of "what connected thing is being missed here?" That lens is what Curator now uses to pick stories, what Drafter writes against, and what every auditor checks for. Without it, a daily-news system drifts into pattern-matching and subject-dismissal. With it, every story has a thread worth pulling. The third sentence is the meta-commitment: the rest of this book — every agent, every prompt, every audit gate, every learning loop — is the project's working answer to *"how do you actually do that?"*

The promise is the only promise worth making: tomorrow morning, there will be another piece.

## What Daylila becomes over time

- After one month: thirty pieces. A habit is starting to form.
- After six months: 180 pieces. Patterns are appearing. Certain subjects recur, sharpened each time.
- After one year: 365 pieces. A real library. An encyclopaedia of "how the world actually works," clustered by subject.
- After three years: 1,000 pieces. Searchable. Curated reading paths. A resource that gets more valuable every single day.

The pieces compound. The system that makes them also compounds — improves itself as it goes, which is the subject of chapter 14. The whole shape of Daylila is slow growth and quiet discipline. Nothing dramatic. Just one more piece, every morning, forever.

Hope. Trust. Progress.
