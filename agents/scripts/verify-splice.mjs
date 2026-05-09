#!/usr/bin/env node
// Regression test for spliceAudioBeats in publisher.ts.
//
// Exists because the 2026-04-17 frontmatter corruption came from a
// regex that consumed the leading newline before the audioBeats block.
// The node-level test lets us verify the pure string transformation
// without standing up the full agents worker.
//
// Usage: node agents/scripts/verify-splice.mjs
// Exit code: 0 on all pass, 1 on any failure.

// Inline copy of the function — import-time ESM from a TS file inside
// agents/ would require full tsc setup; since this is a small string
// transformation we keep the duplicate in sync by eye. The regex must
// match publisher.ts:spliceAudioBeats. Sync if one changes.
function spliceAudioBeats(mdx, audioBeats) {
  const withoutExisting = mdx.replace(/(\n)audioBeats:\n(?:  .+\n)*/, '$1');
  const lines = Object.entries(audioBeats).map(
    ([key, url]) => `  ${key}: ${JSON.stringify(url)}`,
  );
  const block = `\naudioBeats:\n${lines.join('\n')}`;
  return withoutExisting.replace(
    /^(---\n[\s\S]*?)(\n---\n)/,
    (_m, p1, p2) => `${p1}${block}${p2}`,
  );
}

let passed = 0;
let failed = 0;

function assertEq(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Case 1: fresh MDX, no existing audioBeats → adds block ────
{
  const input = `---
title: "Test"
date: "2026-04-22"
---

# body
`;
  const expected = `---
title: "Test"
date: "2026-04-22"
audioBeats:
  beat-1: "https://r2.example/1.mp3"
  beat-2: "https://r2.example/2.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/1.mp3',
    'beat-2': 'https://r2.example/2.mp3',
  });
  assertEq('Case 1: fresh MDX adds audioBeats block', actual, expected);
}

// ─── Case 2: re-splice same map → idempotent, output === input ────
{
  const input = `---
title: "Test"
qualityFlag: "low"
audioBeats:
  beat-1: "https://r2.example/1.mp3"
  beat-2: "https://r2.example/2.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/1.mp3',
    'beat-2': 'https://r2.example/2.mp3',
  });
  assertEq('Case 2: idempotent re-splice with identical map', actual, input);
}

// ─── Case 3: re-splice different map → strips old, inserts new,
//     frontmatter terminator intact (THE 2026-04-17 CORRUPTION CASE) ────
{
  const input = `---
title: "Test"
qualityFlag: "low"
audioBeats:
  beat-1: "https://r2.example/old1.mp3"
---

# body
`;
  const expected = `---
title: "Test"
qualityFlag: "low"
audioBeats:
  beat-1: "https://r2.example/new1.mp3"
  beat-2: "https://r2.example/new2.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/new1.mp3',
    'beat-2': 'https://r2.example/new2.mp3',
  });
  assertEq('Case 3: re-splice different map preserves frontmatter terminator', actual, expected);
}

// ─── Case 4: audioBeats followed by another frontmatter key (not ---)
//     → strip only the audioBeats block, keep the later key. The new
//     audioBeats gets re-inserted at end-of-frontmatter (splice regex
//     targets the position just before closing `---`), so block
//     position changes. That's fine — content schema doesn't care
//     about frontmatter key order. Other keys must survive. ────
{
  const input = `---
title: "Test"
audioBeats:
  beat-1: "https://r2.example/1.mp3"
voiceScore: 95
---

# body
`;
  const expected = `---
title: "Test"
voiceScore: 95
audioBeats:
  beat-1: "https://r2.example/new1.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/new1.mp3',
  });
  assertEq('Case 4: audioBeats followed by another key — strips block, keeps sibling key', actual, expected);
}

// ─── Case 5: payload contains literal `$1` → must NOT expand into
//     capture group 1. The 2026-05-09 corruption case in reverse:
//     Director's claimReviews splice used a string-template
//     replacement which interpreted `$N` in the JSON payload as
//     backreferences. publisher.ts uses the same regex shape, so a
//     URL or key with `$1` would corrupt the same way. The callback
//     form (functions don't interpret `$` patterns) makes this safe.
//     See DECISIONS 2026-05-09. ────
{
  const input = `---
title: "Test"
---

# body
`;
  const expected = `---
title: "Test"
audioBeats:
  beat-1: "https://r2.example/path-with-$1-and-$2-tokens.mp3"
---

# body
`;
  const actual = spliceAudioBeats(input, {
    'beat-1': 'https://r2.example/path-with-$1-and-$2-tokens.mp3',
  });
  assertEq('Case 5: payload with literal $1/$2 does not expand into capture groups', actual, expected);
}

// ─── Static check: agents/src/director.ts must not reintroduce the
//     string-template form for any of its 7 frontmatter splices. The
//     2026-05-09 corruption proved that the string-template form is a
//     foot-gun whenever the payload comes from unstructured Drafter
//     text. Callback form is the only safe shape. See DECISIONS
//     2026-05-09. ────
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const directorPath = path.join(here, '..', 'src', 'director.ts');
  const src = fs.readFileSync(directorPath, 'utf8');
  // Strip line comments + block comments before scanning (the fix
  // commit added a block comment that legitimately contains `$1`).
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // String-template `$1` or `$2` inside a `.replace(...)` call's
  // second argument. The pattern `currentMdx.replace(\n…\n  `$1...`)`
  // wraps across lines, so we look for the `replace(` opening and
  // scan ~200 chars forward for a backtick string starting with `$1`
  // or `$2`.
  const lines = stripped.split('\n');
  let firstHit = null;
  for (let i = 0; i < lines.length; i++) {
    if (!/\.replace\(/.test(lines[i])) continue;
    const window = lines.slice(i, i + 5).join('\n');
    if (/`\$[12][^`]*`/.test(window)) {
      firstHit = `line ${i + 1}: ${lines[i].trim()}`;
      break;
    }
  }
  assertEq(
    'Static: director.ts has zero string-template `$1`/`$2` replacements',
    firstHit,
    null,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
