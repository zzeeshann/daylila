# 01 — What is the internet, really?

*Status: outline. To be expanded by a future session — see WRITING-MORE.md.*

---

## What this chapter covers

- The internet is not "the cloud." It is a physical thing — specific cables, specific buildings, specific machines.
- Most of the internet lives in data centres owned by a few large companies.
- Every website you visit is a conversation between two computers: yours and one somewhere else.
- The "somewhere else" is called a server. It's just a computer running all the time, answering requests.
- URLs are addresses. DNS is the phone book that turns names like `daylila.com` into numeric addresses.
- HTTP and HTTPS are the language two computers use to exchange pages, like a greeting protocol.

## Why this matters for Daylila

- Daylila has no traditional server. It uses Cloudflare Workers instead — small programs that run on Cloudflare's network of data centres around the world. (Chapter 3 explains.)
- The reader's computer talks to the closest Cloudflare data centre, not to a single machine somewhere. This is fast and cheap. It is also a somewhat new way of doing things — most websites still have "a server" you could in principle point at on a map.

## Key terms introduced

- server, data centre, URL, DNS, HTTP, HTTPS, request, response
