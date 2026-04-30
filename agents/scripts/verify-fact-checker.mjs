#!/usr/bin/env node
// Regression test for the 2026-04-30 fact-checker rewrite that replaced
// DuckDuckGo Instant Answer with Anthropic's server-side web_search tool.
//
// Background: pre-fix, FactChecker ran two Claude calls + one DDG IA
// query per claim. DDG IA only resolved Wikipedia-style topics, so for
// ~95% of news claims it returned empty and Claude's first-pass
// verdict — formed from training data alone — became the reader-facing
// truth. The 2026-04-30 J. Craig Venter piece exposed this when the
// drawer rendered "this appears to be speculative fiction set in 2026"
// on a real death the model didn't know about.
//
// Fix: single Messages call with `tools: [{type: "web_search_20250305",
// name: "web_search", max_uses: 8}]`. Claude searches before verdicting.
// Response is a heterogeneous list of text / server_tool_use /
// web_search_tool_result blocks. The agent walks them, concats text
// for JSON extraction, counts tool uses for `searchUsed`, scans for
// `unavailable` errors for `searchAvailable`.
//
// This verifier exercises that response-parsing path without standing
// up Anthropic — it stubs the response shape and asserts the parsed
// FactCheckResult.
//
// Inlined `parseFactCheckerResponse` stays in sync with
// agents/src/fact-checker.ts:parseResponse by hand. Same convention
// as verify-pair-slug / verify-parse-retry / verify-categoriser-floor /
// verify-interactive-voice / verify-splice / verify-dedup /
// verify-normalize / verify-validator.
//
// Usage: node agents/scripts/verify-fact-checker.mjs
// Exit code: 0 on all pass, 1 on any failure.

/** Minimal extractJson mirror — copied from agents/src/shared/parse-json.ts */
function extractJson(text) {
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  throw new Error(`Could not extract JSON: ${text.slice(0, 200)}`);
}

/** Mirror of FactCheckerAgent.parseResponse(). Walks content blocks,
 *  extracts JSON from concatenated text, counts tool uses. */
function parseFactCheckerResponse(content) {
  let textCombined = '';
  let searchUsed = false;
  let searchAvailable = true;

  for (const block of content) {
    if (block.type === 'text') {
      textCombined += block.text;
    } else if (block.type === 'server_tool_use') {
      searchUsed = true;
    } else if (block.type === 'web_search_tool_result') {
      const inner = block.content;
      if (inner && !Array.isArray(inner)) {
        if (inner.type === 'web_search_tool_result_error' && inner.error_code === 'unavailable') {
          searchAvailable = false;
        }
      }
    }
  }

  let parsed;
  try {
    parsed = extractJson(textCombined);
  } catch {
    return { passed: true, claims: [], searchUsed, searchAvailable };
  }

  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
  const hasIncorrect = claims.some((c) => c.status === 'incorrect');

  return {
    passed: !hasIncorrect,
    claims,
    searchUsed,
    searchAvailable,
  };
}

let pass = 0;
let fail = 0;
function check(name, expected, actual) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got === want) {
    console.log(`  PASS  ${name}`);
    pass += 1;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        expected: ${want}`);
    console.log(`        got:      ${got}`);
    fail += 1;
  }
}

console.log('verify-fact-checker — parseResponse shape');

// 1. Pure text response (no tool use) — general-knowledge claim, no search needed
{
  const content = [
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "the human genome has about 3 billion base pairs", "status": "verified", "note": "Well-established general knowledge."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('1. pure-text response, no tool use, single verified claim', {
    passed: true,
    claims: [{ claim: 'the human genome has about 3 billion base pairs', status: 'verified', note: 'Well-established general knowledge.' }],
    searchUsed: false,
    searchAvailable: true,
  }, got);
}

// 2. Response with web_search invocation + final JSON — typical news-claim path
{
  const content = [
    { type: 'text', text: 'I will verify the death claim via web search.' },
    {
      type: 'server_tool_use',
      id: 'srvtoolu_01',
      name: 'web_search',
      input: { query: 'J. Craig Venter death 2026' },
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_01',
      content: [
        {
          type: 'web_search_result',
          url: 'https://nytimes.com/example',
          title: 'J. Craig Venter, scientist who decoded the human genome, dies',
          page_age: '2026-04-30',
        },
      ],
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "J. Craig Venter died this week", "status": "verified", "note": "Confirmed via NYT obituary published 2026-04-30."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('2. searched + verified — searchUsed flips true, claim verified', {
    passed: true,
    claims: [{ claim: 'J. Craig Venter died this week', status: 'verified', note: 'Confirmed via NYT obituary published 2026-04-30.' }],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

// 3. web_search returned `unavailable` — searchAvailable flips false; Claude
//    falls back to training data + still returns JSON
{
  const content = [
    { type: 'text', text: 'I will search for confirmation.' },
    {
      type: 'server_tool_use',
      id: 'srvtoolu_02',
      name: 'web_search',
      input: { query: 'random current event' },
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_02',
      content: { type: 'web_search_tool_result_error', error_code: 'unavailable' },
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "some specific 2026 number", "status": "unverified", "note": "Could not verify against current sources."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('3. web_search unavailable — searchAvailable flips false', {
    passed: true,
    claims: [{ claim: 'some specific 2026 number', status: 'unverified', note: 'Could not verify against current sources.' }],
    searchUsed: true,
    searchAvailable: false,
  }, got);
}

// 4. Claim found contradicted by search → status=incorrect → passed=false
{
  const content = [
    {
      type: 'server_tool_use',
      id: 'srvtoolu_03',
      name: 'web_search',
      input: { query: 'fuel prices spiked 50 percent' },
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_03',
      content: [{ type: 'web_search_result', url: 'https://example.com', title: 'Fuel up 5%', page_age: '2026-04-29' }],
    },
    {
      type: 'text',
      text: '{"passed": false, "claims": [{"claim": "fuel prices spiked 50% last month", "status": "incorrect", "note": "Search found ~5%, not 50%."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('4. contradicted claim — incorrect → passed=false', {
    passed: false,
    claims: [{ claim: 'fuel prices spiked 50% last month', status: 'incorrect', note: 'Search found ~5%, not 50%.' }],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

// 5. Multiple text blocks interleaved with tools — JSON extraction must
//    work after concatenating all text blocks (Claude often writes
//    reasoning text before AND after a tool turn)
{
  const content = [
    { type: 'text', text: 'Let me check the first claim.' },
    { type: 'server_tool_use', id: 'srvtoolu_04', name: 'web_search', input: { query: 'foo' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_04',
      content: [{ type: 'web_search_result', url: 'https://x', title: 'foo', page_age: '2026-04-30' }],
    },
    { type: 'text', text: 'Now the second claim.' },
    { type: 'server_tool_use', id: 'srvtoolu_05', name: 'web_search', input: { query: 'bar' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_05',
      content: [{ type: 'web_search_result', url: 'https://y', title: 'bar', page_age: '2026-04-30' }],
    },
    {
      type: 'text',
      text: 'Final verdict:\n{"passed": true, "claims": [{"claim": "foo", "status": "verified", "note": "Confirmed."}, {"claim": "bar", "status": "verified", "note": "Confirmed."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('5. multi-block interleaved — JSON extracts from concat text', {
    passed: true,
    claims: [
      { claim: 'foo', status: 'verified', note: 'Confirmed.' },
      { claim: 'bar', status: 'verified', note: 'Confirmed.' },
    ],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
