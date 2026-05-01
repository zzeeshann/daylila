#!/usr/bin/env node
// Regression test for the FactChecker response parser.
//
// Background. Pre-2026-04-30, FactChecker ran two Claude calls + DDG IA
// per claim. DDG IA only resolved Wikipedia-style topics, so ~95% of
// news claims fell back to Claude's training-data verdict. The Venter
// piece exposed the cost when the drawer rendered "this appears to be
// speculative fiction set in 2026" on a real death.
//
// 2026-04-30 (Phases A → I) replaced DDG with Anthropic's
// `web_search_20250305` server tool. Phase F+G added per-claim
// citations + cited_text + searchQuery via Claude self-reporting URLs
// in a `sources` field with cross-reference defense against
// hallucinations.
//
// Path A (2026-05-01) dropped Phase F+G's per-claim self-report
// architecture. Claude is no longer asked for URLs at all. The agent
// harvests citation URLs server-side from the
// `web_search_result_location` blocks Anthropic auto-attaches to text
// blocks, dedups, and exposes a flat `result.sources: string[]`. The
// drawer renders one "Sources consulted" line under the Facts section
// from that flat list.
//
// This verifier exercises the simplified response-parsing path
// without standing up Anthropic — it stubs the response shape and
// asserts the parsed FactCheckResult.
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

/** Mirror of FactCheckerAgent.parseResponse() — Path A shape.
 *  Walks content blocks once, harvests citation URLs into a deduped
 *  flat list, parses the JSON claim list. No per-claim source
 *  attribution. */
function parseFactCheckerResponse(content) {
  let textCombined = '';
  let searchUsed = false;
  let searchAvailable = true;
  const sources = new Set();

  for (const block of content) {
    if (block.type === 'text') {
      textCombined += block.text;
      if (Array.isArray(block.citations)) {
        for (const c of block.citations) {
          if (c.type === 'web_search_result_location' && typeof c.url === 'string' && c.url.length > 0) {
            sources.add(c.url);
          }
        }
      }
    } else if (block.type === 'server_tool_use') {
      searchUsed = true;
    } else if (block.type === 'web_search_tool_result') {
      const inner = block.content;
      if (Array.isArray(inner)) {
        // Harvest URLs from search hits — guaranteed populated when
        // web_search succeeds. Mirrors the agent's parseResponse.
        for (const result of inner) {
          if (result.type === 'web_search_result' && typeof result.url === 'string' && result.url.length > 0) {
            sources.add(result.url);
          }
        }
      } else if (inner && !Array.isArray(inner)) {
        if (inner.type === 'web_search_tool_result_error' && inner.error_code === 'unavailable') {
          searchAvailable = false;
        }
      }
    }
  }

  const flatSources = Array.from(sources);

  let parsed;
  try {
    parsed = extractJson(textCombined);
  } catch {
    return { passed: true, claims: [], searchUsed, searchAvailable, sources: flatSources };
  }

  const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];
  const claims = rawClaims.map((rc) => {
    const status = (rc.status === 'verified' || rc.status === 'unverified' || rc.status === 'incorrect')
      ? rc.status
      : 'unverified';
    const claimText = typeof rc.claim === 'string' ? rc.claim : '';
    const note = typeof rc.note === 'string' ? rc.note : '';
    return { claim: claimText, status, note };
  });
  const hasIncorrect = claims.some((c) => c.status === 'incorrect');

  return {
    passed: !hasIncorrect,
    claims,
    searchUsed,
    searchAvailable,
    sources: flatSources,
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

console.log('verify-fact-checker — parseResponse shape (Path A)');

// =============================================================
// Core cases — JSON extraction + flag semantics
// =============================================================

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
    sources: [],
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
  check('2. searched + verified — searchUsed flips true, claim verified, search-hit URLs harvested', {
    passed: true,
    claims: [{ claim: 'J. Craig Venter died this week', status: 'verified', note: 'Confirmed via NYT obituary published 2026-04-30.' }],
    searchUsed: true,
    searchAvailable: true,
    sources: ['https://nytimes.com/example'],
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
    sources: [],
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
  check('4. contradicted claim — incorrect → passed=false, search-hit URL harvested', {
    passed: false,
    claims: [{ claim: 'fuel prices spiked 50% last month', status: 'incorrect', note: 'Search found ~5%, not 50%.' }],
    searchUsed: true,
    searchAvailable: true,
    sources: ['https://example.com'],
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
  check('5. multi-block interleaved — JSON extracts from concat text, both search hits harvested', {
    passed: true,
    claims: [
      { claim: 'foo', status: 'verified', note: 'Confirmed.' },
      { claim: 'bar', status: 'verified', note: 'Confirmed.' },
    ],
    searchUsed: true,
    searchAvailable: true,
    sources: ['https://x', 'https://y'],
  }, got);
}

// =============================================================
// Path A cases — flat sources harvest from citation metadata
// =============================================================

// 6. Two citations attached to a text block → result.sources contains
//    both URLs deduped (no per-claim attribution).
{
  const content = [
    { type: 'server_tool_use', id: 'srv_06', name: 'web_search', input: { query: 'Venter dies 2026' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_06',
      content: [
        { type: 'web_search_result', url: 'https://nyt.com/v', title: 'Venter dies', page_age: '2026-04-30' },
        { type: 'web_search_result', url: 'https://reuters.com/v', title: 'Genome scientist dies', page_age: '2026-04-30' },
      ],
    },
    {
      type: 'text',
      text: 'Confirmed via NYT and Reuters.',
      citations: [
        {
          type: 'web_search_result_location',
          url: 'https://nyt.com/v',
          title: 'Venter dies',
          cited_text: 'J. Craig Venter, scientist who decoded the human genome, dies at 79',
        },
        {
          type: 'web_search_result_location',
          url: 'https://reuters.com/v',
          title: 'Genome scientist dies',
          cited_text: 'Pioneering geneticist J. Craig Venter has died.',
        },
      ],
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "Venter died this week", "status": "verified", "note": "Confirmed via NYT and Reuters obituaries."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('6. 2 citations on response → result.sources contains both URLs deduped', {
    passed: true,
    claims: [{ claim: 'Venter died this week', status: 'verified', note: 'Confirmed via NYT and Reuters obituaries.' }],
    searchUsed: true,
    searchAvailable: true,
    sources: ['https://nyt.com/v', 'https://reuters.com/v'],
  }, got);
}

// 7. Citations spread across multiple text blocks → all URLs surface in
//    result.sources, deduped by URL. Order of first appearance preserved.
{
  const content = [
    { type: 'server_tool_use', id: 'srv_07a', name: 'web_search', input: { query: 'A' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_07a',
      content: [{ type: 'web_search_result', url: 'https://a.com', title: 'A page', page_age: '2026-04-30' }],
    },
    {
      type: 'text',
      text: 'First check.',
      citations: [{ type: 'web_search_result_location', url: 'https://a.com', title: 'A page', cited_text: 'fact about A' }],
    },
    { type: 'server_tool_use', id: 'srv_07b', name: 'web_search', input: { query: 'B' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_07b',
      content: [{ type: 'web_search_result', url: 'https://b.com', title: 'B page', page_age: '2026-04-30' }],
    },
    {
      type: 'text',
      text: 'Second check.',
      citations: [
        { type: 'web_search_result_location', url: 'https://b.com', title: 'B page', cited_text: 'fact about B' },
        // Same URL repeated — agent dedups.
        { type: 'web_search_result_location', url: 'https://a.com', title: 'A page', cited_text: 'related context' },
      ],
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "claim A", "status": "verified", "note": "Found."}, {"claim": "claim B", "status": "verified", "note": "Found."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('7. citations spread across multiple blocks → all surface in result.sources, deduped', {
    passed: true,
    claims: [
      { claim: 'claim A', status: 'verified', note: 'Found.' },
      { claim: 'claim B', status: 'verified', note: 'Found.' },
    ],
    searchUsed: true,
    searchAvailable: true,
    sources: ['https://a.com', 'https://b.com'],
  }, got);
}

// 8. Production-shape regression: Claude returns NO sources field on any
//    claim AND citations attach to text blocks. result.sources populated
//    via the union of both tracks (search hits + citations), deduped.
{
  const content = [
    { type: 'server_tool_use', id: 'srv_08', name: 'web_search', input: { query: 'CVE-2026-31431 Linux' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_08',
      content: [
        { type: 'web_search_result', url: 'https://nvd.nist.gov/c', title: 'NVD entry', page_age: '2026-04-29' },
        { type: 'web_search_result', url: 'https://theregister.com/r', title: 'The Register', page_age: '2026-04-29' },
      ],
    },
    {
      type: 'text',
      text: 'Disclosed April 29.',
      citations: [
        { type: 'web_search_result_location', url: 'https://nvd.nist.gov/c', title: 'NVD entry', cited_text: 'CVE-2026-31431 disclosed' },
        { type: 'web_search_result_location', url: 'https://theregister.com/r', title: 'The Register', cited_text: 'severe Linux threat' },
      ],
    },
    {
      type: 'text',
      // No `sources` field on the claim — production behaviour after Path A.
      text: '{"passed": true, "claims": [{"claim": "CVE-2026-31431 disclosed April 29", "status": "verified", "note": "Confirmed via NVD + The Register."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('8. no sources field in Claude JSON, citations present → both tracks deduped', {
    passed: true,
    claims: [{ claim: 'CVE-2026-31431 disclosed April 29', status: 'verified', note: 'Confirmed via NVD + The Register.' }],
    searchUsed: true,
    searchAvailable: true,
    sources: ['https://nvd.nist.gov/c', 'https://theregister.com/r'],
  }, got);
}

// 9. The Lebanon-piece production scenario: web_search fires, search
//    hits come back, Claude paraphrases the content into prose notes
//    WITHOUT attaching citations to its text blocks. Citation-only
//    harvest would yield empty; search-hit harvest gets every URL.
//    This is the case that broke after the first Path A ship.
{
  const content = [
    { type: 'server_tool_use', id: 'srv_09', name: 'web_search', input: { query: 'ceasefire Lebanon Hezbollah November 2024' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_09',
      content: [
        { type: 'web_search_result', url: 'https://bbc.com/news/article-a', title: 'BBC News', page_age: '2024-11-27' },
        { type: 'web_search_result', url: 'https://reuters.com/world/article-b', title: 'Reuters', page_age: '2024-11-28' },
        { type: 'web_search_result', url: 'https://nytimes.com/2024/11/27/article-c', title: 'NYT', page_age: '2024-11-27' },
      ],
    },
    // Claude paraphrases without explicit citation refs — the dominant
    // pattern in production. No `citations` array on any text block.
    {
      type: 'text',
      text: 'Verified via multiple sources. Confirmed - ceasefire signed November 27, 2024.',
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "Israel and Hezbollah signed a ceasefire November 27, 2024", "status": "verified", "note": "Confirmed via BBC, Reuters, and NYT reporting."}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('9. Lebanon-shape: paraphrased notes, no citations → result.sources from search hits alone', {
    passed: true,
    claims: [{ claim: 'Israel and Hezbollah signed a ceasefire November 27, 2024', status: 'verified', note: 'Confirmed via BBC, Reuters, and NYT reporting.' }],
    searchUsed: true,
    searchAvailable: true,
    sources: ['https://bbc.com/news/article-a', 'https://reuters.com/world/article-b', 'https://nytimes.com/2024/11/27/article-c'],
  }, got);
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
