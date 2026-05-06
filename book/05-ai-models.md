# 05 — What is an AI model, actually?

A lot of the confusion about AI comes from the word "AI" itself. It's too big. It covers everything from the autofill in your phone to the chess engine that beat the world champion to the thing that wrote the first draft of this book. They don't have much in common.

The kind of AI Daylila uses is specifically a **large language model**, usually called an LLM. Understanding what one of these is — roughly — unlocks most of the rest.

## The simplest explanation

An LLM is a computer program that, given some text, predicts what text is most likely to come next.

That's it. That's the whole thing.

If you give it `The capital of France is`, it predicts `Paris`. If you give it `Once upon a time`, it predicts `there was`. If you give it a question, it predicts an answer. If you give it a half-written essay, it predicts the rest.

How it learned to predict well is the complicated part. The short version: it was trained on an enormous amount of text — much of the public internet, many books, many documents — and during that training it adjusted billions of internal parameters until it got good at predicting what came next.

The result is a program that has, in some useful sense, learned the shape of human writing. It knows that questions are usually followed by answers. It knows how stories tend to unfold. It knows how facts are phrased. It knows what a well-constructed argument looks like.

## What it is not

An LLM does not look things up. It is not a search engine. It does not have real-time access to the internet. Everything it "knows" is baked into those internal parameters during training.

This has consequences. An LLM's knowledge is frozen at the moment training ended — called its **knowledge cutoff**. If something happened after the cutoff, the model doesn't know about it, though it may confidently produce text that sounds like it does.

An LLM does not understand what it's saying in any deep sense. It is doing extremely sophisticated pattern-matching, not thinking in the way a human thinks. Whether that distinction matters depends on what you're asking it to do.

An LLM can be wrong. It can produce confident, well-phrased text that is factually nonsense. This is called **hallucination** and it is not a bug that will be fixed next year — it's inherent to how the technology works. You have to plan for it.

## What Claude is

**Claude** is a specific LLM, made by a company called **Anthropic**. Daylila uses a version of Claude called **Sonnet 4.5**. When a Daylila agent "thinks," what's actually happening is: the agent packages up some text (a prompt) and sends it to Anthropic's servers. Anthropic's servers run the text through Claude. Claude returns a response. The agent reads the response and does something with it.

Daylila does this dozens of times every morning. Scanner picks stories — no Claude call, just RSS parsing. Curator picks the most teachable one — one Claude call. Drafter writes the piece — one large Claude call. Three auditors check it — three Claude calls. Integrator fixes problems — possibly more Claude calls, up to three rounds. Learner writes patterns — one Claude call. Drafter reflects on its own work — one Claude call.

Each call costs money. Each call takes a few seconds to a minute depending on how much text is involved. The costs and times are why Daylila is careful about which agents call Claude and which ones just run plain code.

## The important distinction: model vs system

Claude is the model. The model is a single function, in the mathematical sense: text in, text out.

Daylila is not the model. Daylila is a **system** built around the model. The system decides what text to send. The system remembers what the model said before. The system combines multiple calls into a workflow. The system stores the outputs in databases and publishes them to websites. The system has sixteen roles, quality gates, and a learning loop.

This is the single most important distinction in this book. When people say "the AI did X," they usually mean "a system that uses an AI did X." The AI itself is a function. Everything interesting is in the system around it.

Daylila is interesting because of the system. The model is a tool. How the tool is used is where the craft lives.

## What Claude is good at and bad at

Good at:
- Writing coherent prose in many voices and styles.
- Following instructions that are specific.
- Summarising long documents.
- Translating between languages.
- Generating explanations of complex topics at different reading levels.
- Most tasks that look like "here is some text, now do something with it."

Bad at:
- Knowing about events after its training cutoff.
- Precise arithmetic (it's surprisingly unreliable at math for a computer).
- Following long instructions without losing track.
- Not confidently making things up when it doesn't know.
- Tasks that require real-time information or actual web browsing (unless explicitly connected to tools that do these things).

A well-built system plays to the model's strengths and compensates for its weaknesses. Daylila's fact-checker exists precisely because Claude is good at writing and bad at reliably knowing — and is now grounded against current web sources via the model's native search tool, so a piece anchored in today's news doesn't get measured against last year's training data. The voice auditor exists because Claude can drift out of a specific voice across a long piece. The integrator handles revision rounds because Claude is better at fixing specific things when told what's wrong than at getting everything perfect on the first try.

The whole architecture is shaped by the model's actual capabilities. Understand the model, and the architecture makes sense.
