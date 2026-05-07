# 04 — How computers remember things

A computer program doesn't naturally remember anything. When it finishes running, everything it was holding in memory disappears. If you want to remember something beyond one run of the program — a user's login, a published piece, a record of what happened yesterday — you have to explicitly write it down somewhere.

"Somewhere" is called storage. There are a few flavours, each good for different things. Daylila uses three: D1, KV, and R2. Here's what each one is for.

## D1 — the relational database

Most programs need to remember structured things. A list of users with email addresses and dates they joined. A list of published pieces with titles, dates, audit scores, and tier labels. A list of audit results, each tied to a piece and a round number and a specific auditor.

For this kind of data, you use a **relational database**. The word "relational" is old and somewhat misleading. What it actually means is: data organised into tables, where each table has named columns and where rows can reference rows in other tables.

Here's what Daylila's `daily_pieces` table looks like, conceptually:

| id | date | title | voice_score | tier |
|---|---|---|---|---|
| 1 | 2026-04-17 | Why QVC Filed for Bankruptcy | 78 | Solid |
| 2 | 2026-04-18 | The 21-Mile Channel That Moves Oil Markets | 95 | Polished |
| 3 | 2026-04-19 | Why Jet Fuel Price Spikes Break Some Airlines | 92 | Polished |

A separate `audit_results` table might have a `piece_id` column that points at the `id` in `daily_pieces`. That's the "relation" — one row in one table pointing at another.

To get information out, you use a language called **SQL** (usually pronounced "sequel" or just "S-Q-L"). It looks like this:

```sql
SELECT title, voice_score FROM daily_pieces WHERE tier = 'Polished';
```

Translated: *give me the title and voice score of every row in daily_pieces where the tier is Polished.*

SQL is old (invented in the 1970s) and it's still everywhere. If you learn any one thing about databases, learn enough SQL to read queries like the one above. That's most of what you need.

**Cloudflare D1** is Cloudflare's version of a relational database. Under the hood it uses **SQLite**, which is a small, fast, reliable database engine that's in practically everything — your phone, your browser, your TV. D1 wraps SQLite so it can be used from Cloudflare Workers and replicated across regions.

Daylila has one D1 database called `daylila`. It has nineteen tables. Chapter references them throughout.

## KV — fast keyed storage

Sometimes you don't need a full relational database. You just need to remember "for this key, the value is this."

Example: rate limiting. Daylila needs to remember "this user tried to log in 5 times in the last 15 minutes." That's a key (the user's IP or ID) and a value (the count). It's not worth a full database table. It's a key-value lookup.

**Cloudflare KV** is a store for that kind of data. Write a value under a key. Read it back by the key. Set an expiry so it auto-deletes after a while. That's it.

KV is fast to read, slow to write (meaning, writes can take a few hundred milliseconds to become visible worldwide), and cheap. It's great for things like rate limits, cached computations, feature flags. It's terrible for anything you need to query by something other than the exact key.

Daylila uses KV for rate limiting login attempts and Zita conversations. Nothing critical. If the KV contents evaporated tomorrow, the worst consequence would be that rate limits reset.

## R2 — object storage for big things

Databases are great for structured data. They're bad at storing large binary files — photos, audio files, PDFs. You can technically put a 5MB MP3 into a database column, but it's clumsy and expensive.

The right tool for big files is called **object storage**. You hand it a file, you get back a URL. The URL points at the file. You can fetch it anywhere, fast, for very little money.

**Cloudflare R2** is Cloudflare's object storage. Daylila uses it to store audio clips. When Audio Producer finishes narrating a beat, it uploads the MP3 to R2. The upload returns a URL. That URL is saved in D1, and the `<audio-player>` component on the piece page uses it to stream the audio.

R2 is similar to Amazon S3 (which you may have heard of). Cloudflare's version doesn't charge "egress" fees — meaning, you don't pay extra when users download from it. That's one of the reasons Daylila uses R2 instead of S3: cheaper for a project that streams audio to readers.

## The three in one sentence each

- **D1** — for structured data you'll query in different shapes (all pieces, pieces by date, pieces with voice score over 85). Has tables, columns, SQL.
- **KV** — for simple key-to-value lookups where you already know the key. Fast and cheap, not queryable by anything other than the key.
- **R2** — for big files. Upload a blob, get a URL. Stream the blob from the URL.

If Daylila were a library, D1 would be the card catalogue, KV would be the front-desk sticky notes, and R2 would be the actual books on shelves.

## Why having three is normal

A real project usually uses multiple kinds of storage. Nobody stores MP3s in a relational database. Nobody stores user records in object storage. Each tool is right for its shape of data. Getting the shapes right is part of the craft.

When Daylila was designed, the choice was roughly: "audit results, published pieces, engagement records" → D1. "Rate limits" → KV. "Audio clips" → R2. Later, when a new kind of data came along (learnings), it went into D1 because it's structured. When reader sessions came along, those went into KV because they're keyed by session ID.

Once you see this pattern, databases stop being mysterious. They're just specialised filing cabinets. Pick the one that matches what you're filing.

## Keeping data forever isn't a virtue

A specialised filing cabinet only works if you're honest about what's worth keeping.

Daylila's database holds three kinds of data. There are the published pieces themselves — those are permanent, part of the record. There are signals tied to those pieces — audit scores, learnings, the per-feedback decisions the Integrator made on each round. Those stay too; they're how the system explains and improves itself. And then there's process noise — every time the Scanner pulls a story it doesn't pick, every "running" status update written to the pipeline log, every routine event written to the observer feed.

Process noise grows fast. At one piece a day with eighty candidates per scan, just the rejected-candidate rows pile up at fifty thousand a year. Multiply that across the half-dozen tables that record process steps and you get millions of rows of nothing-ever-read in a few years.

The honest answer is to delete it. Not all of it — published-piece audits stay forever — but the process noise has a window. Ninety days for routine observer events, ninety days for unselected candidates, one hundred and eighty for the per-step pipeline log. Each table's window reflects how long a human might plausibly want to look at it. After that, it's gone.

A small worker runs at four in the morning each day, walks the policy table, and deletes what's expired. It logs what it did to the same observer feed it's helping prune. Before it deletes anything from a table that could link to a published piece, it checks that the rows it's about to delete don't link — if any do, it stops and writes a high-severity event, because that's a bug, not retention.

The discipline is small but the principle behind it matters: every row a system keeps is a row it has to read past, back up, and reason about. Keeping data forever isn't a virtue. Keeping the right data forever is.
