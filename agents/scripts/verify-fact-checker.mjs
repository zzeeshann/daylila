#!/usr/bin/env node
// Regression test for the 2026-04-30 fact-checker rewrite that replaced
// DuckDuckGo Instant Answer with Anthropic's server-side web_search tool,
// plus the 2026-04-30 (Phase F + G) extension that captures per-claim
// citations + cited_text + searchQuery from web_search_result_location
// blocks and cross-references against URLs Claude names in each claim's
// `sources` array (drops hallucinated URLs).
//
// Background (Phase A): pre-fix, FactChecker ran two Claude calls + one
// DDG IA query per claim. DDG IA only resolved Wikipedia-style topics, so
// for ~95% of news claims it returned empty and Claude's first-pass
// verdict — formed from training data alone — became the reader-facing
// truth. The 2026-04-30 J. Craig Venter piece exposed this when the
// drawer rendered "this appears to be speculative fiction set in 2026"
// on a real death the model didn't know about.
//
// Phase A fix: single Messages call with `tools: [{type:
// "web_search_20250305", name: "web_search", max_uses: 8}]`. Claude
// searches before verdicting. Response is a heterogeneous list of
// text / server_tool_use / web_search_tool_result blocks. The agent
// walks them, concats text for JSON extraction, counts tool uses for
// `searchUsed`, scans for `unavailable` errors for `searchAvailable`.
//
// Phase F + G fix (this verifier extension): the agent additionally
// harvests citations (web_search_result_location blocks) attached to
// text blocks (Claude's reasoning prose), captures the searchQuery
// (`server_tool_use.input.query`) preceding each citation, and
// cross-references against URLs Claude names in each claim's
// `sources` array. Hallucinated URLs (Claude named a URL not in any
// citation block) are dropped; kept URLs are enriched with title +
// citedText + searchQuery.
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
 *  extracts JSON from concatenated text, counts tool uses, harvests
 *  citations, cross-references with Claude-named source URLs. */
function parseFactCheckerResponse(content) {
  let textCombined = '';
  let searchUsed = false;
  let searchAvailable = true;
  const searchQueries = [];
  const citationsByUrl = new Map();

  for (const block of content) {
    if (block.type === 'text') {
      textCombined += block.text;
      if (Array.isArray(block.citations)) {
        for (const c of block.citations) {
          if (c.type === 'web_search_result_location' && typeof c.url === 'string' && c.url.length > 0) {
            if (!citationsByUrl.has(c.url)) {
              citationsByUrl.set(c.url, {
                title: typeof c.title === 'string' ? c.title : undefined,
                citedText: typeof c.cited_text === 'string' ? c.cited_text : undefined,
                searchQuery: searchQueries.length > 0 ? searchQueries[searchQueries.length - 1] : undefined,
              });
            }
          }
        }
      }
    } else if (block.type === 'server_tool_use') {
      searchUsed = true;
      if (block.input && typeof block.input.query === 'string' && block.input.query.length > 0) {
        searchQueries.push(block.input.query);
      }
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

  const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];
  const claims = rawClaims.map((rc) => {
    const status = (rc.status === 'verified' || rc.status === 'unverified' || rc.status === 'incorrect')
      ? rc.status
      : 'unverified';
    const claimText = typeof rc.claim === 'string' ? rc.claim : '';
    const note = typeof rc.note === 'string' ? rc.note : '';

    const claudeSources = Array.isArray(rc.sources) ? rc.sources : [];
    const enriched = [];
    const seen = new Set();
    for (const raw of claudeSources) {
      if (typeof raw !== 'string' || raw.length === 0) continue;
      if (seen.has(raw)) continue;
      const meta = citationsByUrl.get(raw);
      if (!meta) continue; // hallucinated URL — drop
      seen.add(raw);
      enriched.push({
        url: raw,
        title: meta.title,
        citedText: meta.citedText,
        searchQuery: meta.searchQuery,
      });
    }

    const out = { claim: claimText, status, note };
    if (enriched.length > 0) out.sources = enriched;
    return out;
  });
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

// =============================================================
// Phase A core cases (1-5) — JSON extraction + flag semantics
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

// =============================================================
// Phase F + G cases (6-10) — citations + cited_text + searchQuery
// =============================================================

// 6. Text block with citations[] containing 2 entries; Claude names both
//    URLs in claim's `sources` → claim's `sources` array has 2 enriched
//    entries with title + citedText + searchQuery populated.
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
      text: '{"passed": true, "claims": [{"claim": "Venter died this week", "status": "verified", "note": "Confirmed via NYT and Reuters obituaries.", "sources": ["https://nyt.com/v", "https://reuters.com/v"]}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('6. 2 citations + Claude names both → enriched sources', {
    passed: true,
    claims: [{
      claim: 'Venter died this week',
      status: 'verified',
      note: 'Confirmed via NYT and Reuters obituaries.',
      sources: [
        { url: 'https://nyt.com/v', title: 'Venter dies', citedText: 'J. Craig Venter, scientist who decoded the human genome, dies at 79', searchQuery: 'Venter dies 2026' },
        { url: 'https://reuters.com/v', title: 'Genome scientist dies', citedText: 'Pioneering geneticist J. Craig Venter has died.', searchQuery: 'Venter dies 2026' },
      ],
    }],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

// 7. Cross-reference defense: Claude names 3 URLs in `sources`, agent
//    sees only 2 of them in citation blocks → 3rd URL is hallucinated,
//    dropped from the kept sources. Kept list is the 2 attested.
{
  const content = [
    { type: 'server_tool_use', id: 'srv_07', name: 'web_search', input: { query: 'genome news' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_07',
      content: [
        { type: 'web_search_result', url: 'https://real1.com', title: 'Real 1', page_age: '2026-04-30' },
        { type: 'web_search_result', url: 'https://real2.com', title: 'Real 2', page_age: '2026-04-30' },
      ],
    },
    {
      type: 'text',
      text: 'Verified.',
      citations: [
        { type: 'web_search_result_location', url: 'https://real1.com', title: 'Real 1', cited_text: 'real fact 1' },
        { type: 'web_search_result_location', url: 'https://real2.com', title: 'Real 2', cited_text: 'real fact 2' },
      ],
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "X happened", "status": "verified", "note": "Multiple sources.", "sources": ["https://real1.com", "https://real2.com", "https://hallucinated.com"]}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('7. hallucinated URL dropped from sources via cross-reference', {
    passed: true,
    claims: [{
      claim: 'X happened',
      status: 'verified',
      note: 'Multiple sources.',
      sources: [
        { url: 'https://real1.com', title: 'Real 1', citedText: 'real fact 1', searchQuery: 'genome news' },
        { url: 'https://real2.com', title: 'Real 2', citedText: 'real fact 2', searchQuery: 'genome news' },
      ],
    }],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

// 8. Citation block contains a URL Claude DIDN'T name in any claim's
//    `sources` → that URL is silently ignored (not surfaced as
//    "additional reference" — would confuse readers).
{
  const content = [
    { type: 'server_tool_use', id: 'srv_08', name: 'web_search', input: { query: 'q' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_08',
      content: [
        { type: 'web_search_result', url: 'https://named.com', title: 'Named', page_age: '2026-04-30' },
        { type: 'web_search_result', url: 'https://unnamed.com', title: 'Unnamed', page_age: '2026-04-30' },
      ],
    },
    {
      type: 'text',
      text: 'Looking at sources.',
      citations: [
        { type: 'web_search_result_location', url: 'https://named.com', title: 'Named', cited_text: 'fact A' },
        { type: 'web_search_result_location', url: 'https://unnamed.com', title: 'Unnamed', cited_text: 'fact B' },
      ],
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "C", "status": "verified", "note": "Note.", "sources": ["https://named.com"]}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('8. unnamed citation URL silently ignored (not surfaced)', {
    passed: true,
    claims: [{
      claim: 'C',
      status: 'verified',
      note: 'Note.',
      sources: [{ url: 'https://named.com', title: 'Named', citedText: 'fact A', searchQuery: 'q' }],
    }],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

// 9. Multi-claim response with citations spread across multiple text
//    blocks → each claim gets its sources from the appropriate citation
//    block (verified by URL match in Claude's `sources` field).
{
  const content = [
    { type: 'server_tool_use', id: 'srv_09a', name: 'web_search', input: { query: 'A' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_09a',
      content: [{ type: 'web_search_result', url: 'https://a.com', title: 'A page', page_age: '2026-04-30' }],
    },
    {
      type: 'text',
      text: 'First check.',
      citations: [{ type: 'web_search_result_location', url: 'https://a.com', title: 'A page', cited_text: 'fact about A' }],
    },
    { type: 'server_tool_use', id: 'srv_09b', name: 'web_search', input: { query: 'B' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_09b',
      content: [{ type: 'web_search_result', url: 'https://b.com', title: 'B page', page_age: '2026-04-30' }],
    },
    {
      type: 'text',
      text: 'Second check.',
      citations: [{ type: 'web_search_result_location', url: 'https://b.com', title: 'B page', cited_text: 'fact about B' }],
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "claim A", "status": "verified", "note": "Found.", "sources": ["https://a.com"]}, {"claim": "claim B", "status": "verified", "note": "Found.", "sources": ["https://b.com"]}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('9. multi-claim — each claim gets the right citation by URL match', {
    passed: true,
    claims: [
      {
        claim: 'claim A',
        status: 'verified',
        note: 'Found.',
        sources: [{ url: 'https://a.com', title: 'A page', citedText: 'fact about A', searchQuery: 'A' }],
      },
      {
        claim: 'claim B',
        status: 'verified',
        note: 'Found.',
        sources: [{ url: 'https://b.com', title: 'B page', citedText: 'fact about B', searchQuery: 'B' }],
      },
    ],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

// 10. searchQuery captured per source from server_tool_use.input.query
//     immediately preceding the citation block. Confirms the position-
//     attribution heuristic.
{
  const content = [
    { type: 'server_tool_use', id: 'srv_10', name: 'web_search', input: { query: 'specific search string' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_10',
      content: [{ type: 'web_search_result', url: 'https://result.com', title: 'R', page_age: '2026-04-30' }],
    },
    {
      type: 'text',
      text: 'Found it.',
      citations: [{ type: 'web_search_result_location', url: 'https://result.com', title: 'R', cited_text: 'short snippet' }],
    },
    {
      type: 'text',
      text: '{"passed": true, "claims": [{"claim": "X", "status": "verified", "note": "Found.", "sources": ["https://result.com"]}]}',
    },
  ];
  const got = parseFactCheckerResponse(content);
  check('10. searchQuery captured from preceding server_tool_use.input.query', {
    passed: true,
    claims: [{
      claim: 'X',
      status: 'verified',
      note: 'Found.',
      sources: [{ url: 'https://result.com', title: 'R', citedText: 'short snippet', searchQuery: 'specific search string' }],
    }],
    searchUsed: true,
    searchAvailable: true,
  }, got);
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
