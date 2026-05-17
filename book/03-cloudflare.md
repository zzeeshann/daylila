# 03 — Cloudflare: where our code runs

A traditional website works like this. Somewhere — usually in a data centre in Virginia or Oregon or Ireland — there is one computer called a server. When you visit a website, your browser asks that one computer for the page. The computer answers. If the computer is in Oregon and you're in Bradford, the message has to travel across the world and back.

This works fine. It has worked fine for thirty years. But it has two problems.

First, the server can only handle so many requests at once. If a website suddenly gets popular, the server gets overwhelmed and the site slows down or crashes. The solution used to be: buy a bigger server.

Second, the server is in one place. If you're far from it, your website feels slow, even if the server itself is fast. The solution used to be: buy more servers, one in each part of the world, and figure out how to keep them all in sync. This is complicated and expensive.

**Cloudflare** solves both problems by running code in a completely different shape.

## What Cloudflare actually is

Cloudflare runs hundreds of data centres — small ones, everywhere. In cities you've heard of (London, São Paulo, Tokyo) and ones you haven't. The whole network works as one computer, but physically distributed across the planet.

When someone visits a website running on Cloudflare, the request goes to the nearest data centre. That data centre runs the code and returns the answer. The reader in Bradford gets served from London. The reader in Tokyo gets served from Tokyo. Nobody waits for a server across the world.

This used to be called a CDN — a content delivery network. CDNs originally just stored copies of files (images, videos, pages) close to readers. They didn't run code. They just cached.

The new thing — what Daylila uses — is that Cloudflare now runs full programs at each of those data centres, not just stored files. These programs are called **Workers**.

## What a Cloudflare Worker is

A Worker is a small program that runs whenever someone makes a request. It can generate a page, answer an API call, check a database, send an email. Anything a traditional server can do, short of running for hours on end.

The important word in that description is **small**. A Worker has to start up, do its job, and finish within a strict time limit — usually under a few seconds, sometimes under thirty. It can't run a long-running process like a video encoder. It can't hold state in memory between requests. Every time a Worker runs, it's essentially fresh.

This sounds like a limitation. It is. It's also the reason Workers can run in hundreds of locations without costing a fortune. The data centres run millions of these tiny programs in parallel, sharing resources. Your Worker shows up when needed, does its thing, and gets out of the way.

Daylila has two Workers:

- **The site worker** (`daylila-v2`) serves the pages you see at `daylila.com`. Every time you load a page, a Worker runs, gets the content, and sends it to your browser.
- **The agents worker** (`daylila-agents`) runs the daily pipeline — Scanner, Curator, Drafter, all of them. This one needs to stay running for minutes, not seconds, so it uses a special Cloudflare feature called **Durable Objects** to keep itself alive and remember state across requests.

## Durable Objects, briefly

A regular Worker is stateless. A Durable Object is a Worker with memory. It's a single instance that lives in one specific data centre, can be addressed like a small private service, and remembers things between calls.

Every Daylila agent is a Durable Object. When Scanner wakes up to read the news, it's talking to a Durable Object named `ScannerAgent`. When Drafter writes a piece, it's a Durable Object named `DrafterAgent`. They can call each other. They can schedule themselves to wake up later (Daylila's audio pipeline uses this — more in chapter 13).

You don't need to understand the full details now. Just hold the idea: Daylila's agents aren't hosted on one big server. They're tiny programs living in Cloudflare's network, waking up when needed, going back to sleep when not.

## How Cloudflare relates to GitHub

When you push code to Daylila's GitHub repo, a GitHub Action automatically tells Cloudflare "new code, please deploy it." Cloudflare rebuilds both Workers with the new code and rolls them out to every data centre worldwide. The whole thing takes about two minutes. Nobody has to log into a server. There is no server to log into.

This is the new shape of software. No machine to maintain. No operating system to patch. No servers to scale. Just code, deployed everywhere, running when needed.

## The honest caveat

Cloudflare is not magic. It has real limits. Workers can't run arbitrary native programs. They have specific time limits per request. They can be expensive once you use a lot of them. And — like any infrastructure — if Cloudflare has a bad day, Daylila has a bad day too. The company has had outages. They happen rarely, but they happen.

For a project like Daylila, the tradeoffs are good. For a project that needed, say, real-time video streaming or a massively complex database, Cloudflare might not be the right choice. Know your tools. The right answer depends on what you're building.

## Free tier and what happens when you hit a limit

Cloudflare's free tier is generous, but it does have caps. Workers can serve 100,000 requests a day for free. Durable Objects get 13,000 GB-seconds of duration a day — a measurement of how much memory the agents used multiplied by how long they ran. On a normal Daylila day, that's about 15% of the cap. Plenty of headroom.

But headroom is not the same as a guarantee. On 2026-05-17, Daylila hit the cap. The cause turned out to be subtle — somewhere inside the Cloudflare Agents SDK, an agent stayed active for about eight hours after its real work had finished. Nothing visible in the logs, nothing the code was obviously asking for. The agent simply did not go to sleep. By midday the daily duration counter was full, Cloudflare started rejecting new agent calls, and Daylila could not publish another piece until the counter reset at midnight UTC.

This is worth thinking about because it tells you something about what "free" really means in cloud infrastructure. Cloudflare didn't charge anything that day — the cap is a hard stop, not a bill. But it also meant the system stopped working for the rest of the day. If Daylila had been on the paid tier, there is no daily cap; the agent would have kept running and Daylila would have paid for the extra time. Not a lot of money, but no automatic stop either. The lesson: **moving to a paid plan removes the cap but also removes the safety net. Whether that's a good trade depends on whether you've built your own safety net first.**

## Building your own kill switch

After 2026-05-17, Daylila grew one. The system now has four things it didn't have before.

**A flag in the database** that says "Director, stop everything." When the flag is set to 1, every agent call checks it at the top and exits immediately. The operator can flip this flag from the admin dashboard or directly from the command line. Even when the agents themselves are stuck or capped, the database accepts the write — these are two different parts of Cloudflare's infrastructure, and one being unhealthy doesn't block the other.

**A health table** that records every long-running operation as it starts and as it finishes. While an operation runs, its row reads `status='running'`. When it ends cleanly, the row flips to `status='completed'`. If something goes wrong and the operation never finishes — the agent crashes, the code is redeployed mid-run, the system enters a state no one designed for — the row sits at `running` forever. That's the breadcrumb.

**A watchdog that fires every hour at minute 30**, separate from any of the agents. It reads the health table. If it finds an operation that has been `running` for longer than the operator's threshold (15 minutes by default, adjustable), it flips that row to `orphaned`, sets the kill-switch flag to 1, and writes a loud escalation event the operator will see. The whole system halts itself. **The watchdog runs in a part of Cloudflare's infrastructure that's separate from the agents themselves — it fires even when the agents are stuck.** That property is the whole point.

**A panel in the admin dashboard** showing the kill-switch status, the threshold, and any currently-running operations. The operator can flip the switch with one click, change the threshold with a save button, and see exactly what's running at any moment.

The first three guard against an agent the operator hasn't noticed yet. The fourth guards against an agent the operator wants to stop right now. Together they mean Daylila can never again burn eight hours of duration silently — at worst it burns forty-five minutes (fifteen-minute threshold plus the wait until the next half-hour watchdog tick), and then it stops.

This is what infrastructure looks like in 2026. The platform gives you most of what you need, then asks you to build the last layer yourself — the layer that's specific to your system, your tolerances, your willingness to stop the world when something looks wrong. Cloudflare can't write that layer for you. They don't know what counts as too long for your workload. But they can give you the parts to build it from: scheduled triggers that fire outside agent context, a database that stays available when the agents don't, a way to read and write flags atomically.

The deeper lesson — for any cloud platform, not just Cloudflare — is that **a generous free tier is not a substitute for designing your own off switch.** If you can't stop your system, you don't really run it.
