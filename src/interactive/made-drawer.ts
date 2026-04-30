/**
 * <made-drawer> — client-side behaviour for the "How this was made"
 * transparency drawer.
 *
 * Responsibilities:
 *   1. Open/close state (click affordance, close button, Escape, backdrop)
 *   2. Fetch /api/daily/{date}/made on first open, cache for the session
 *   3. Render the envelope: piece summary, timeline, rounds, rules, candidates
 *   4. URL hash deep-link (`#made` opens; closing clears)
 *   5. Focus trap + body scroll lock while open
 *
 * The markup scaffold is server-rendered by src/components/MadeBy.astro;
 * this component only populates `[data-made-body]` once data arrives.
 */

import { auditTier, auditTierLabel } from '../lib/audit-tier';
import { pipelineStepLabel } from '../lib/pipeline-steps';
import type { MadeEnvelope, MadeFactClaim } from '../lib/made-by';

/**
 * Voice-contract rules shown as a plain reference card. The drawer does
 * NOT try to light up individual rules per piece — we don't store
 * per-rule pass/fail, and inferring it from freeform violation strings
 * was noisy and misleading. Readers see the rules here and the
 * auditor violations in "What the auditors said" — they can connect the
 * two themselves.
 */
const VOICE_RULES = [
  'Plain English',
  'No tribe words',
  'Short sentences',
  'Specific beats general',
  'No flattery',
  'Trust the reader',
];

const STRUCTURE_RULES = [
  'Hook: one screen, curiosity only',
  'Teaching: one idea per beat',
  'Practice: only when concrete',
  'Close: one sentence, no CTA',
];

class MadeDrawer extends HTMLElement {
  private date = '';
  private pieceId = '';
  private envelope: MadeEnvelope | null = null;
  private loading = false;
  private openerEl: HTMLButtonElement | null = null;
  private closeEl: HTMLButtonElement | null = null;
  private backdropEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private lastFocus: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private hashHandler: (() => void) | null = null;

  connectedCallback() {
    this.date = this.getAttribute('data-date') ?? '';
    this.pieceId = this.getAttribute('data-piece-id') ?? '';
    this.openerEl = this.querySelector('[data-made-open]');
    this.closeEl = this.querySelector('[data-made-close]');
    this.backdropEl = this.querySelector('[data-made-backdrop]');
    this.panelEl = this.querySelector('.made-panel');
    this.bodyEl = this.querySelector('[data-made-body]');

    this.openerEl?.addEventListener('click', (e) => {
      e.preventDefault();
      this.open();
    });
    this.closeEl?.addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
    });
    this.backdropEl?.addEventListener('click', () => this.close());

    // Lazy-load: do NOT fetch on mount. Only fetch on first open (or if the
    // page lands with #made in the URL). Saves one D1 query per page view
    // for readers who never open the drawer.

    // Auto-open when URL hash is #made on page load
    if (window.location.hash === '#made') {
      // defer so layout settles first
      requestAnimationFrame(() => this.open());
    }
    this.hashHandler = () => {
      if (window.location.hash === '#made' && !this.hasAttribute('data-open')) this.open();
      if (window.location.hash !== '#made' && this.hasAttribute('data-open')) this.close();
    };
    window.addEventListener('hashchange', this.hashHandler);
  }


  disconnectedCallback() {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.hashHandler) {
      window.removeEventListener('hashchange', this.hashHandler);
      this.hashHandler = null;
    }
    document.body.classList.remove('made-locked');
  }

  private async open() {
    if (!this.panelEl) return;
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.setAttribute('data-open', '');
    this.panelEl.removeAttribute('hidden');
    document.body.classList.add('made-locked');

    // Reflect in URL — but only if not already #made (avoid hashchange loop)
    if (window.location.hash !== '#made') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#made`);
    }

    // Keyboard: Escape + focus trap
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key === 'Tab') this.trapFocus(e);
    };
    window.addEventListener('keydown', this.keyHandler);

    // Focus first focusable inside the panel (the close button)
    setTimeout(() => this.closeEl?.focus(), 30);

    // If the mount-time load already finished, render now.
    if (this.envelope) {
      this.render();
    } else if (!this.loading) {
      await this.load();
    }
  }

  private close() {
    if (!this.panelEl) return;
    this.removeAttribute('data-open');
    this.panelEl.setAttribute('hidden', '');
    document.body.classList.remove('made-locked');

    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    // Clear #made from the URL without reloading
    if (window.location.hash === '#made') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }

    this.lastFocus?.focus();
  }

  private trapFocus(e: KeyboardEvent) {
    if (!this.panelEl) return;
    const focusables = this.panelEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private async load() {
    if (!this.bodyEl) return;
    this.loading = true;
    try {
      // pieceId query param scopes the learnings filter to THIS piece
      // (Phase 7 writeLearning piece_id extension). Other envelope
      // sections (pipeline, audits, candidates, audio) stay date-keyed
      // per Phase 3 walk-back reasoning — "today's pipeline activity"
      // is a valid day-view. At multi-per-day the pieceId is authoritative
      // for learnings only; other sections keep pooling by date.
      const url = this.pieceId
        ? `/api/daily/${this.date}/made?pieceId=${encodeURIComponent(this.pieceId)}`
        : `/api/daily/${this.date}/made`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      this.envelope = await res.json();
      this.render();
    } catch {
      this.bodyEl.innerHTML = `<p class="made-list-empty" style="padding: 2rem 0">Couldn't load the making-of right now. Try again in a moment.</p>`;
    } finally {
      this.loading = false;
    }
  }

  private render() {
    if (!this.bodyEl || !this.envelope) return;
    const env = this.envelope;

    const html: string[] = [];

    // --- Piece summary -------------------------------------------------
    if (env.piece) {
      const p = env.piece;
      const tier = p.tier ?? auditTier(p.voiceScore, p.qualityFlag);
      html.push(`
        <section class="made-piece">
          <p class="made-piece-headline">${escapeHtml(p.headline)}</p>
          <p class="made-piece-meta">
            ${p.voiceScore != null ? `<span>Voice ${p.voiceScore}/100</span><span class="sep">·</span>` : ''}
            <span class="made-tier made-tier-${tier}">${auditTierLabel(tier)}</span>
            ${p.wordCount != null ? `<span class="sep">·</span><span>${p.wordCount} words</span>` : ''}
            ${p.beatCount != null ? `<span class="sep">·</span><span>${p.beatCount} beats</span>` : ''}
          </p>
        </section>
      `);
    }

    // --- Timeline ------------------------------------------------------
    if (env.timeline.length > 0) {
      const start = env.timeline[0].t;
      // Each phase logs a 'running' row and a terminal row (done / failed /
      // skipped). Collapse pairs into one row per phase. Prefer the terminal
      // row for status, detail, and timestamp; fall back to the running row
      // when the phase is still in progress.
      const collapsed = collapseTimeline(env.timeline);
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">Timeline</h3>
          <ol class="made-timeline">
            ${collapsed.map((s) => renderStep(s, start)).join('')}
          </ol>
        </section>
      `);
    }

    // --- Rounds --------------------------------------------------------
    if (env.rounds.length > 0) {
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">What the auditors said</h3>
          ${env.rounds.map((r, i) => renderRound(r, i === env.rounds.length - 1)).join('')}
        </section>
      `);
    }

    // --- Rules (voice contract) ---------------------------------------
    html.push(`
      <section class="made-section">
        <h3 class="made-section-header">Rules applied</h3>
        <p class="made-section-note">Every piece is held to these. Specific violations for this piece are in "What the auditors said" above.</p>
        <div class="made-rules">
          <p class="made-rules-title">Voice contract — non-negotiables</p>
          <ul class="made-rules-list">
            ${VOICE_RULES.map((r) => `<li class="made-rule">${escapeHtml(r)}</li>`).join('')}
          </ul>
          <p class="made-rules-title" style="margin-top:0.875rem">Lesson structure</p>
          <ul class="made-rules-list">
            ${STRUCTURE_RULES.map((r) => `<li class="made-rule">${escapeHtml(r)}</li>`).join('')}
          </ul>
          <p class="made-rules-footer">
            Full contract: <a href="https://github.com/zzeeshann/zeemish-v2/blob/main/content/voice-contract.md" target="_blank" rel="noopener">voice-contract.md</a>
          </p>
        </div>
      </section>
    `);

    // --- Candidates ----------------------------------------------------
    if (env.candidates.total > 0) {
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">What Scanner surfaced</h3>
          <p class="made-section-note">${env.candidates.total} candidates today. Curator picked the one above. We don't store <em>why</em> — only what was considered.</p>
          <div class="made-candidates" data-made-candidates>
            <button class="made-candidates-toggle" type="button" data-made-candidates-toggle>
              <span>Also considered (${env.candidates.alsoConsidered.length})</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="made-candidates-body">
              ${env.candidates.alsoConsidered.map(renderCandidate).join('')}
            </div>
          </div>
        </section>
      `);
    }

    // --- Audio ---------------------------------------------------------
    if (env.audio && env.audio.beats.length > 0) {
      const a = env.audio;
      const modelLabel = a.model === 'eleven_multilingual_v2'
        ? 'ElevenLabs Multilingual v2'
        : (a.model ?? 'ElevenLabs');
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">Audio</h3>
          <p class="made-section-note">
            ${a.beats.length} beat${a.beats.length === 1 ? '' : 's'} narrated by
            <strong>Frederick Surrey</strong> via ${escapeHtml(modelLabel)} ·
            ${a.totalCharacters.toLocaleString()} characters
          </p>
          <ul class="made-list" style="margin-top:0.5rem">
            ${a.beats
              .map(
                (b) => `<li>${escapeHtml(b.beatName)} — ${b.characterCount.toLocaleString()} chars</li>`,
              )
              .join('')}
          </ul>
        </section>
      `);
    }

    // --- Categories Categoriser assigned ------------------------------
    // Categoriser fires 1s after `publishing done`. Empty array = pre-
    // 2026-04-23 piece, declined, or failed — section omits in all cases.
    if (env.categories && env.categories.length > 0) {
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">Filed under</h3>
          <p class="made-section-note">
            Categoriser placed this piece in ${env.categories.length} of the library's categories after publish.
          </p>
          <div class="made-categories">
            ${env.categories.map(renderCategory).join('')}
          </div>
        </section>
      `);
    }

    // --- Interactives (quiz + html, both per piece since Phase 2) ---
    // Two independent sections — quiz from `env.interactive`, html
    // from `env.htmlInteractive`. Either can be null if that path
    // hasn't run / declined / pre-dates the agent. Both sections share
    // the same renderer with a per-type kind argument that controls
    // the section header and CTA wording.
    if (env.interactive) {
      html.push(renderInteractiveSection(env.interactive, 'quiz'));
    }
    if (env.htmlInteractive) {
      html.push(renderInteractiveSection(env.htmlInteractive, 'html'));
    }

    // --- Commit link ---------------------------------------------------
    if (env.piece?.commitUrl || env.piece?.filePath) {
      const published = env.piece.publishedAt
        ? new Date(env.piece.publishedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        : null;
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">The final commit</h3>
          <p class="made-commit">
            ${published ? `Published ${escapeHtml(published)} as ` : 'Published as '}
            ${env.piece.filePath ? `<code>${escapeHtml(env.piece.filePath)}</code>` : ''}
            ${env.piece.commitUrl ? ` <a href="${env.piece.commitUrl}" target="_blank" rel="noopener">View commit on GitHub →</a>` : ''}
          </p>
        </section>
      `);
    }

    // --- What the system learned from this piece -----------------------
    // Grouped by source in a fixed order: Drafter's voice first
    // (narrative first-person), then Learner (terser system-level),
    // then reader/zita (post-traffic). Absent entirely when no
    // learnings are pinned to this piece.
    if (env.learnings.length > 0) {
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">What the system learned from this piece</h3>
          ${renderLearningGroups(env.learnings)}
        </section>
      `);
    }

    this.bodyEl.innerHTML = html.join('');

    // Wire up candidates toggle
    const candToggle = this.bodyEl.querySelector<HTMLButtonElement>('[data-made-candidates-toggle]');
    const candWrap = this.bodyEl.querySelector<HTMLElement>('[data-made-candidates]');
    candToggle?.addEventListener('click', () => {
      if (!candWrap) return;
      if (candWrap.hasAttribute('data-expanded')) {
        candWrap.removeAttribute('data-expanded');
      } else {
        candWrap.setAttribute('data-expanded', '');
      }
    });
  }
}

// --- Render helpers (pure functions, kept outside the class) ---------

/**
 * Collapse paired running/done rows per phase into a single displayable
 * row. Each phase (scanning, curating, drafting, auditing_rN, …) writes
 * a 'running' row when it starts and a terminal row (done/failed/skipped)
 * when it ends. Showing both doubles the timeline length with no extra
 * information — prefer the terminal row (richer data) and keep the
 * 'running' row only when a phase is still in progress at fetch time.
 */
function collapseTimeline(
  steps: MadeEnvelope['timeline'],
): MadeEnvelope['timeline'] {
  const byStep = new Map<string, MadeEnvelope['timeline'][number]>();
  const order: string[] = [];
  for (const s of steps) {
    if (!byStep.has(s.step)) {
      order.push(s.step);
      byStep.set(s.step, s);
      continue;
    }
    const prev = byStep.get(s.step)!;
    // Terminal status always wins over 'running'. If both are terminal
    // (shouldn't happen for a well-formed run), keep the latest.
    const prevTerminal = prev.status !== 'running';
    const thisTerminal = s.status !== 'running';
    if (thisTerminal || (!prevTerminal && s.t > prev.t)) {
      byStep.set(s.step, s);
    }
  }
  return order.map((k) => byStep.get(k)!);
}

function renderStep(s: MadeEnvelope['timeline'][number], startMs: number): string {
  const label = pipelineStepLabel(s.step);
  const state = s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : 'running';
  const rel = relativeTime(s.t - startMs);
  const detail = stepDetail(s);

  return `
    <li class="made-step" data-state="${state}">
      <span class="made-step-dot" aria-hidden="true"></span>
      <div>
        <span class="made-step-label">${escapeHtml(label)}<span class="made-step-time">${rel}</span></span>
        ${detail ? `<p class="made-step-detail">${detail}</p>` : ''}
      </div>
    </li>
  `;
}

function stepDetail(s: MadeEnvelope['timeline'][number]): string {
  const d = s.data ?? {};
  const parts: string[] = [];
  if (d.candidateCount != null) parts.push(`${d.candidateCount} candidates`);
  if (d.headline) parts.push(`"${escapeHtml(String(d.headline))}"`);
  if (d.wordCount != null && d.beatCount != null) parts.push(`${d.wordCount} words · ${d.beatCount} beats`);
  if (d.voiceScore != null) {
    const bits = [`Voice ${d.voiceScore}/100`];
    if (d.factsPassed != null) bits.push(`Facts ${d.factsPassed ? '✓' : '✗'}`);
    if (d.structurePassed != null) bits.push(`Structure ${d.structurePassed ? '✓' : '✗'}`);
    parts.push(bits.join(' · '));
  }
  if (d.qualityFlag === 'low') parts.push('published with tier <strong>Rough</strong>');
  return parts.join(' · ');
}

function renderRound(r: MadeEnvelope['rounds'][number], isLatest: boolean): string {
  const voiceTier = auditTier(r.voice.score ?? null);
  const voiceVerdict = r.voice.score != null
    ? `${auditTierLabel(voiceTier)} · ${r.voice.score}/100`
    : (r.voice.passed ? 'Passing' : 'Mixed');
  const voiceCls = voiceTier === 'polished' ? 'made-gate-verdict-ok' : 'made-gate-verdict-mixed';
  const barCls = voiceTier === 'polished' ? '' : 'made-gate-bar-fill-muted';

  return `
    <div class="made-round">
      <div class="made-round-header">
        <span class="made-round-title">${isLatest ? 'Final round' : `Round ${r.round}`}</span>
        <span class="made-round-summary">${r.voice.violations.length + r.structure.issues.length + r.fact.claims.length} notes</span>
      </div>

      <div class="made-gate">
        <div class="made-gate-head">
          <span class="made-gate-label">Voice</span>
          <span class="made-gate-verdict ${voiceCls}">${escapeHtml(voiceVerdict)}</span>
        </div>
        ${r.voice.score != null ? `
          <div class="made-gate-bar"><div class="made-gate-bar-fill ${barCls}" style="width:${Math.max(0, Math.min(100, r.voice.score))}%"></div></div>
        ` : ''}
        ${renderStringList(r.voice.violations, 'No violations flagged.')}
      </div>

      <div class="made-gate">
        <div class="made-gate-head">
          <span class="made-gate-label">Facts</span>
          <span class="made-gate-verdict ${r.fact.passed ? 'made-gate-verdict-ok' : 'made-gate-verdict-mixed'}">${r.fact.passed ? 'Passing' : 'Mixed'}</span>
        </div>
        ${renderClaims(r.fact.claims)}
      </div>

      <div class="made-gate">
        <div class="made-gate-head">
          <span class="made-gate-label">Structure</span>
          <span class="made-gate-verdict ${r.structure.passed ? 'made-gate-verdict-ok' : 'made-gate-verdict-mixed'}">${r.structure.passed ? 'Passing' : 'Mixed'}</span>
        </div>
        ${renderStringList(r.structure.issues, 'No structural issues.')}
      </div>
    </div>
  `;
}

function renderStringList(items: string[], emptyNote: string): string {
  if (items.length === 0) return `<p class="made-list-empty">${escapeHtml(emptyNote)}</p>`;
  return `<ul class="made-list">${items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</ul>`;
}

/**
 * Defense-in-depth: scrub any cutoff-confession phrasing that slips
 * through the FactChecker prompt. The 2026-04-30 web_search rewrite
 * forbids these phrases in the prompt itself; this filter catches
 * regressions silently rather than embarrassing readers.
 *
 * Triggered case: J. Craig Venter piece (2026-04-30) rendered "appears
 * to be speculative fiction set in 2026" verbatim on a real death the
 * model didn't know about. See CLAUDE.md "FactChecker — Anthropic
 * web_search replaces DuckDuckGo" for the full narrative.
 *
 * Match is case-insensitive on substring. If any phrase fires, the
 * whole note is replaced — not patched in place — so the reader never
 * sees fragments of the original confession.
 */
const CUTOFF_CONFESSION_PHRASES = [
  'speculative fiction',
  'knowledge cutoff',
  'as of my',
  'training data',
  'is hypothetical',
  'beyond my training',
] as const;

function sanitizeFactNote(note: string): string {
  const lower = note.toLowerCase();
  for (const phrase of CUTOFF_CONFESSION_PHRASES) {
    if (lower.includes(phrase)) return 'Could not verify against current sources.';
  }
  return note;
}

function renderClaims(claims: MadeFactClaim[]): string {
  if (claims.length === 0) return `<p class="made-list-empty">No claims reviewed.</p>`;
  return `<ul class="made-list">${claims.map((c) => {
    const statusCls = c.status === 'verified' ? 'made-claim-verified'
      : c.status === 'unverified' ? 'made-claim-unverified'
      : c.status === 'contested' || c.status === 'incorrect' ? 'made-claim-contested'
      : 'made-claim-unverified';
    const safeNote = c.note ? sanitizeFactNote(c.note) : '';
    return `
      <li>
        <div class="made-claim">
          <span>${escapeHtml(c.claim)}</span>
          ${c.status ? `<span class="made-claim-status ${statusCls}">${escapeHtml(c.status)}</span>` : ''}
          ${safeNote ? `<span class="made-claim-note">${escapeHtml(safeNote)}</span>` : ''}
        </div>
      </li>
    `;
  }).join('')}</ul>`;
}

/**
 * Group learnings by source in a fixed render order, drop empty groups,
 * return the HTML. Fixed order (not alphabetical, not data-driven):
 *   1. self-reflection — Drafter's narrative first-person critique
 *   2. producer        — Learner's (+ StructureEditor's) terse patterns
 *   3. reader          — post-traffic engagement signals
 *   4. zita            — question-pattern signals
 * Unknown / null source falls into a defensive "Learning pattern"
 * bucket at the end (same fallback Build 1's Memory panel uses).
 */
const LEARNING_SOURCE_ORDER = ['self-reflection', 'producer', 'reader', 'zita'] as const;
const LEARNING_SOURCE_LABEL: Record<string, string> = {
  'self-reflection': 'Drafter self-reflection',
  'producer': 'Learner, producer-side pattern',
  'reader': 'Reader signal',
  'zita': 'Zita question pattern',
};
const LEARNING_FALLBACK_LABEL = 'Learning pattern';

function renderLearningGroups(learnings: MadeEnvelope['learnings']): string {
  const bySource = new Map<string, string[]>();
  for (const l of learnings) {
    const key = l.source && LEARNING_SOURCE_LABEL[l.source] ? l.source : '__fallback__';
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(l.observation);
  }

  const groups: string[] = [];
  for (const src of LEARNING_SOURCE_ORDER) {
    const items = bySource.get(src);
    if (items && items.length > 0) {
      groups.push(renderLearningGroup(LEARNING_SOURCE_LABEL[src], items));
    }
  }
  const fallback = bySource.get('__fallback__');
  if (fallback && fallback.length > 0) {
    groups.push(renderLearningGroup(LEARNING_FALLBACK_LABEL, fallback));
  }
  return groups.join('');
}

function renderLearningGroup(title: string, observations: string[]): string {
  return `
    <div class="made-learning-group">
      <p class="made-learning-group-title">${escapeHtml(title)}</p>
      <ul class="made-list">
        ${observations.map((obs) => `<li class="made-learning">${escapeHtml(obs)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderCategory(c: MadeEnvelope['categories'][number]): string {
  const slug = encodeURIComponent(c.slug);
  return `
    <a class="made-category-chip" href="/library/${slug}/">
      <span class="made-category-name">${escapeHtml(c.name)}</span>
      <span class="made-category-confidence">${c.confidence}% confident</span>
    </a>
  `;
}

/**
 * Reader-facing copy for `qualityFlag === 'low'`. When per-round
 * audit data is available (post-2026-04-25 migration 0023), name
 * the dimension(s) the auditor flagged. Otherwise fall back to the
 * generic copy from 2026-04-25 (legacy interactives + transient
 * D1 read failures both land here).
 *
 * "essence-not-reference" is the long-form name; the auditor calls
 * the dimension `essence` internally. "essence-not-reference"
 * better signals what the rubric measures to a non-operator reader.
 */
const DIMENSION_LABEL: Record<string, string> = {
  voice: 'voice',
  structure: 'structure & pedagogy',
  essence: 'essence-not-reference',
  factual: 'factual',
};

function buildLowNote(failedDimensions: string[]): string {
  if (failedDimensions.length === 0) {
    return 'The auditor flagged a concern beyond voice across all 3 rounds. The quiz still shipped — readers can try it and judge for themselves.';
  }
  const labels = failedDimensions.map((d) => DIMENSION_LABEL[d] ?? d);
  const joined = labels.length === 1
    ? labels[0]
    : labels.length === 2
      ? `${labels[0]} and ${labels[1]}`
      : `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  const rubricWord = labels.length === 1 ? 'rubric' : 'rubrics';
  return `The auditor flagged the ${joined} ${rubricWord} across all 3 rounds. The quiz still shipped — readers can try it and judge for themselves.`;
}

function renderInteractiveSection(
  i: NonNullable<MadeEnvelope['interactive']>,
  kind: 'quiz' | 'html',
): string {
  const slug = encodeURIComponent(i.slug);
  const typeLabel = i.type || 'interactive';
  const revisionsLabel = i.revisionCount === 1 ? '1 revision' : `${i.revisionCount} revisions`;
  const meta: string[] = [];
  if (i.voiceScore != null) meta.push(`Voice ${i.voiceScore}/100`);
  meta.push(revisionsLabel);
  const lowNote = i.qualityFlag === 'low'
    ? `<p class="made-interactive-low">${escapeHtml(buildLowNote(i.failedDimensions))}</p>`
    : '';
  // Quiz vs HTML wording differs at the surfaces a reader actually sees:
  // section header (what got built) and CTA verb (what to do with it).
  // Both ship per piece since Phase 2; the drawer differentiates so a
  // reader scanning the section list knows there are two artefacts.
  const header = kind === 'html'
    ? 'The interactive model built from this piece'
    : 'The quiz built from this piece';
  const cta = kind === 'html' ? 'Try the model →' : 'Try the quiz →';
  return `
    <section class="made-section">
      <h3 class="made-section-header">${header}</h3>
      <p class="made-section-note">
        A ${escapeHtml(typeLabel)} titled "${escapeHtml(i.title)}" · ${meta.join(' · ')}
      </p>
      ${lowNote}
      <a class="made-interactive-cta" href="/interactives/${slug}/">
        ${cta}
      </a>
    </section>
  `;
}

function renderCandidate(c: MadeEnvelope['candidates']['alsoConsidered'][number]): string {
  const title = c.url
    ? `<a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.headline)}</a>`
    : escapeHtml(c.headline);
  const meta: string[] = [];
  if (c.source) meta.push(escapeHtml(c.source));
  if (c.category) meta.push(escapeHtml(c.category));
  if (c.teachabilityScore != null) meta.push(`teach ${c.teachabilityScore}`);
  return `
    <div class="made-candidate">
      <span class="made-candidate-headline">${title}</span>
      ${meta.length > 0 ? `<span class="made-candidate-meta">${meta.join(' · ')}</span>` : ''}
    </div>
  `;
}

function relativeTime(diffMs: number): string {
  if (diffMs <= 0) return 'start';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `+${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `+${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `+${hrs}h ${mins % 60}m`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

customElements.define('made-drawer', MadeDrawer);

export { MadeDrawer };
