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
import { CUTOFF_CONFESSION_PHRASES, CUTOFF_CONFESSION_REPLACEMENT } from '../lib/fact-check-thresholds';
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

    // --- Piece summary (always visible — orienting header, not a section) -
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

    // Each named section below is a native <details> wrapped via
    // renderSection(). All collapsed by default. The summary line carries
    // the section title plus an at-a-glance hint derived from the envelope
    // so a reader scanning collapsed labels still sees something useful.

    // --- Timeline ------------------------------------------------------
    if (env.timeline.length > 0) {
      const start = env.timeline[0].t;
      const collapsed = collapseTimeline(env.timeline);
      const lastT = collapsed[collapsed.length - 1]?.t ?? start;
      const dur = relativeTime(lastT - start).replace(/^\+/, '');
      const phaseCount = collapsed.length;
      const hint = `${phaseCount} phase${phaseCount === 1 ? '' : 's'}${dur && dur !== 'start' ? ` · ${dur}` : ''}`;
      const body = `
        <ol class="made-timeline">
          ${collapsed.map((s) => renderStep(s, start)).join('')}
        </ol>
      `;
      html.push(renderSection('Timeline', hint, body));
    }

    // --- Rounds --------------------------------------------------------
    if (env.rounds.length > 0) {
      const n = env.rounds.length;
      const hint = `${n} round${n === 1 ? '' : 's'}`;
      const body = env.rounds.map((r, i) => renderRound(r, i === n - 1)).join('');
      html.push(renderSection('What the auditors said', hint, body));
    }

    // --- Final state ---------------------------------------------------
    // The audit notes above show the journey across rounds; this block
    // names the destination — what shipped. The verdict sentence ("passed
    // all three audits" / "shipped as Rough") is promoted to the section's
    // <summary> hint so the at-a-glance reader sees the destination even
    // when collapsed. The expanded body shows the per-gate meta + foot.
    const fs = buildFinalState(env);
    if (fs) {
      html.push(renderSection('Final state', fs.hint, fs.body));
    }

    // --- Rules (voice contract) ---------------------------------------
    {
      const body = `
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
            Full contract: <a href="https://github.com/zzeeshann/daylila/blob/main/content/voice-contract.md" target="_blank" rel="noopener">voice-contract.md <span class="made-glyph-teal" aria-hidden="true">↗</span></a>
          </p>
        </div>
      `;
      html.push(renderSection('Rules applied', null, body));
    }

    // --- Candidates ----------------------------------------------------
    if (env.candidates.total > 0) {
      const total = env.candidates.total;
      const hint = `${total} candidate${total === 1 ? '' : 's'}`;
      const body = `
        <p class="made-section-note">${total} candidates today. Curator picked the one above. We don't store <em>why</em> — only what was considered.</p>
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
      `;
      html.push(renderSection('What Scanner surfaced', hint, body));
    }

    // --- Audio ---------------------------------------------------------
    if (env.audio && env.audio.beats.length > 0) {
      const a = env.audio;
      const modelLabel = a.model === 'eleven_multilingual_v2'
        ? 'ElevenLabs Multilingual v2'
        : (a.model ?? 'ElevenLabs');
      const beatCount = a.beats.length;
      const hint = `${beatCount} beat${beatCount === 1 ? '' : 's'} · ${formatChars(a.totalCharacters)}`;
      const body = `
        <p class="made-section-note">
          ${beatCount} beat${beatCount === 1 ? '' : 's'} narrated by
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
      `;
      html.push(renderSection('Audio', hint, body));
    }

    // --- Categories Categoriser assigned ------------------------------
    // Categoriser fires 1s after `publishing done`. Empty array = pre-
    // 2026-04-23 piece, declined, or failed — section omits in all cases.
    if (env.categories && env.categories.length > 0) {
      const hint = env.categories.map((c) => c.name).join(', ');
      const body = `
        <p class="made-section-note">
          Categoriser placed this piece in ${env.categories.length} of the library's categories after publish.
        </p>
        <div class="made-categories">
          ${env.categories.map(renderCategory).join('')}
        </div>
      `;
      html.push(renderSection('Filed under', hint, body));
    }

    // --- Interactives (quiz + html, both per piece since Phase 2) ---
    // Two independent sections — quiz from `env.interactive`, html
    // from `env.htmlInteractive`. Either can be null if that path
    // hasn't run / declined / pre-dates the agent.
    if (env.interactive) {
      const { label, hint, body } = buildInteractiveSection(env.interactive, 'quiz');
      html.push(renderSection(label, hint, body));
    }
    if (env.htmlInteractive) {
      const { label, hint, body } = buildInteractiveSection(env.htmlInteractive, 'html');
      html.push(renderSection(label, hint, body));
    }

    // --- Commit link ---------------------------------------------------
    if (env.piece?.commitUrl || env.piece?.filePath) {
      const published = env.piece.publishedAt
        ? new Date(env.piece.publishedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        : null;
      const shortDate = env.piece.publishedAt
        ? new Date(env.piece.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : null;
      const hint = shortDate ? `Published ${shortDate}` : null;
      const body = `
        <p class="made-commit">
          ${published ? `Published ${escapeHtml(published)} as ` : 'Published as '}
          ${env.piece.filePath ? `<code>${escapeHtml(env.piece.filePath)}</code>` : ''}
          ${env.piece.commitUrl ? ` <a href="${env.piece.commitUrl}" target="_blank" rel="noopener">View commit on GitHub <span class="made-glyph-teal" aria-hidden="true">↗</span></a>` : ''}
        </p>
      `;
      html.push(renderSection('The final commit', hint, body));
    }

    // --- What the system learned from making this piece ----------------
    // Visual break + intro paragraph reframe the section as forward-
    // looking — these notes are patterns for tomorrow's Drafter, not a
    // verdict on the piece a reader just finished. The intro lives INSIDE
    // the details body so it's the first thing visible on expand;
    // collapsed, the bullets are hidden so the framing protection isn't
    // needed at that level.
    if (env.learnings.length > 0) {
      const tier = env.piece?.tier ?? auditTier(env.piece?.voiceScore, env.piece?.qualityFlag);
      const intro = tier === 'rough'
        ? 'These notes look back at how this piece was made and forward to how the next piece can be better. The piece you just read shipped as Rough; these notes are how the system improves over time.'
        : 'These notes look back at how this piece was made and forward to how the next piece can be better. They are not a verdict on what you just read — that piece passed its audits and shipped. These are how the system improves over time.';
      const n = env.learnings.length;
      const hint = `${n} note${n === 1 ? '' : 's'}`;
      const body = `
        <p class="made-section-note">${escapeHtml(intro)}</p>
        ${renderLearningGroups(env.learnings)}
      `;
      // Visual break sits between making-history and learning-forward
      // sections — reads visually even when both are collapsed.
      html.push(`<div class="made-section-break" aria-hidden="true"></div>`);
      html.push(renderSection('What the system learned from making this piece', hint, body));
    }

    this.bodyEl.innerHTML = html.join('');

    // Wire up the Scanner section's "Also considered" sub-collapsible.
    // The parent <details> for Scanner handles its own expand/collapse via
    // native browser behaviour; this wires the inner toggle that hides the
    // 70+ candidate rows even when the Scanner section is open.
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
 * Wrap a section's body in a native <details>/<summary> so it's
 * collapsible by default. The summary line carries the section title
 * and an optional at-a-glance hint (e.g., "6 beats · 9.3k chars",
 * "passed all three audits") derived from the envelope so the
 * collapsed state is still informative. Caret rotates 90° on open
 * via CSS — same teal affordance the existing "Also considered"
 * sub-toggle uses, so visual language stays consistent.
 *
 * No JS toggle wiring needed — native <details> handles expand /
 * collapse plus keyboard (Space, Enter) and screen-reader semantics.
 */
function renderSection(label: string, hint: string | null, body: string): string {
  return `
    <details class="made-section">
      <summary class="made-section-summary">
        <span class="made-section-title">${escapeHtml(label)}</span>
        ${hint ? `<span class="made-section-hint">${escapeHtml(hint)}</span>` : ''}
        <svg class="made-section-caret" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </summary>
      <div class="made-section-body">${body}</div>
    </details>
  `;
}

/** Compact character-count for at-a-glance summary hints. 9342 → "9.3k chars". */
function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

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

/**
 * Build the Final-state block — the destination sentence ("passed all
 * three audits" / "shipped as Rough") plus per-gate meta and foot copy.
 *
 * The verdict sentence is returned as `hint` and surfaced in the
 * section's <summary> label so an at-a-glance reader sees the
 * destination without expanding. The expanded body shows just the
 * meta + foot so the verdict isn't duplicated.
 *
 * Numerics from the latest round in env.rounds; tier from the piece-
 * level audit-tier helper. Returns null for legacy pieces with no
 * audit_results rows so the section silently omits.
 */
function buildFinalState(env: MadeEnvelope): { hint: string; body: string } | null {
  if (env.rounds.length === 0 || !env.piece) return null;
  const final = env.rounds[env.rounds.length - 1];
  const tier = env.piece.tier ?? auditTier(env.piece.voiceScore, env.piece.qualityFlag);
  const tierLabel = auditTierLabel(tier);
  const voiceScore = final.voice.score ?? env.piece.voiceScore;
  const factsLabel = final.fact.passed ? 'passing' : 'mixed';
  const structureLabel = final.structure.passed ? 'passing' : 'mixed';
  const allPassed = final.voice.passed && final.fact.passed && final.structure.passed;

  const verdict = tier === 'rough'
    ? 'shipped as Rough'
    : allPassed
      ? 'passed all three audits'
      : `shipped as ${tierLabel}, with mixed signals`;

  const meta = voiceScore != null
    ? `Voice ${voiceScore}/100 (${tierLabel}). Facts ${factsLabel}. Structure ${structureLabel}.`
    : `Facts ${factsLabel}. Structure ${structureLabel}.`;

  const foot = tier === 'rough'
    ? 'Three rounds didn’t get every gate to pass. The piece shipped anyway because the day’s news doesn’t wait. The audit notes above show what happened.'
    : 'The piece you just read reflects these results. The audit notes above show how it got here.';

  const body = `
    <div class="made-final-state">
      <p class="made-final-state-meta">${escapeHtml(meta)}</p>
      <p class="made-final-state-foot">${escapeHtml(foot)}</p>
    </div>
  `;

  return { hint: verdict, body };
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
        ${renderClaims(r.fact.claims, r.fact.sources)}
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
 *
 * Phrase list canonical at `content/fact-check-contract.md`; TS
 * constants at `src/lib/fact-check-thresholds.ts` (site-side mirror
 * of `agents/src/shared/fact-check-thresholds.ts`). The
 * `'training data'` trigger was deliberately dropped per
 * DECISIONS:497 (false-positive risk).
 */
function sanitizeFactNote(note: string): string {
  const lower = note.toLowerCase();
  for (const phrase of CUTOFF_CONFESSION_PHRASES) {
    if (lower.includes(phrase)) return CUTOFF_CONFESSION_REPLACEMENT;
  }
  return note;
}

/**
 * Render the round-level "Sources consulted" line (Path A, 2026-05-01).
 *
 * Replaces Phase F+G's per-claim source sub-section. Reads the flat
 * `result.sources: string[]` Anthropic's web_search returned across the
 * whole audit (harvested server-side from `web_search_result_location`
 * citation metadata). Dedups by hostname (strips `www.`), caps at 5
 * unique domains, renders one small line under the claims list:
 *
 *   Sources consulted: nytimes.com · reuters.com · bbc.com
 *
 * Each domain links to its first-occurrence URL. Empty input returns
 * empty string — pre-Path-A audit rows have no top-level `sources`
 * field, so the line gracefully omits.
 */
function renderFactSources(sources: string[] | undefined): string {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const seen = new Set<string>();
  const domains: Array<{ host: string; url: string }> = [];
  for (const url of sources) {
    if (typeof url !== 'string' || url.length === 0) continue;
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (seen.has(host)) continue;
      seen.add(host);
      domains.push({ host, url });
      if (domains.length >= 5) break;
    } catch {
      /* malformed URL — skip */
    }
  }
  if (domains.length === 0) return '';
  const links = domains
    .map(
      (d, i) =>
        `${i > 0 ? '<span class="made-fact-sources-sep" aria-hidden="true">·</span>' : ''}<a class="made-fact-sources-link" href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.host)} <span class="made-glyph-teal" aria-hidden="true">↗</span></a>`,
    )
    .join('');
  return `<p class="made-fact-sources"><span class="made-fact-sources-label">Sources consulted:</span>${links}</p>`;
}

function renderClaims(claims: MadeFactClaim[], sources: string[] | undefined): string {
  const sourcesHtml = renderFactSources(sources);
  if (claims.length === 0) {
    return `<p class="made-list-empty">No claims reviewed.</p>${sourcesHtml}`;
  }
  const claimsHtml = `<ul class="made-list">${claims.map((c) => {
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
  return `${claimsHtml}${sourcesHtml}`;
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
  'self-reflection': 'What the Drafter noted for future pieces',
  'producer': 'Patterns extracted for tomorrow’s Drafter',
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
    return 'The auditor flagged a concern beyond voice across all 3 rounds. The quiz is published anyway — early days for the auditor’s interactive judgement, and we trust readers to tell us what works.';
  }
  const labels = failedDimensions.map((d) => DIMENSION_LABEL[d] ?? d);
  const joined = labels.length === 1
    ? labels[0]
    : labels.length === 2
      ? `${labels[0]} and ${labels[1]}`
      : `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  const rubricWord = labels.length === 1 ? 'rubric' : 'rubrics';
  return `The auditor flagged the ${joined} ${rubricWord} across all 3 rounds. The quiz is published anyway — early days for the auditor’s interactive judgement, and we trust readers to tell us what works.`;
}

function buildInteractiveSection(
  i: NonNullable<MadeEnvelope['interactive']>,
  kind: 'quiz' | 'html',
): { label: string; hint: string; body: string } {
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
  const label = kind === 'html'
    ? 'The interactive model built from this piece'
    : 'The quiz built from this piece';
  const cta = kind === 'html' ? 'Try the model →' : 'Try the quiz →';

  // Hint surfaces the revision count plus the low-quality marker so a
  // reader scanning collapsed labels sees the artefact's quality state
  // at a glance without having to expand.
  const hint = i.qualityFlag === 'low'
    ? `${revisionsLabel} · low-quality flag`
    : revisionsLabel;

  const body = `
    <p class="made-section-note">
      A ${escapeHtml(typeLabel)} titled "${escapeHtml(i.title)}" · ${meta.join(' · ')}
    </p>
    ${lowNote}
    <a class="made-interactive-cta" href="/interactives/${slug}/">
      ${cta}
    </a>
  `;

  return { label, hint, body };
}

function renderCandidate(c: MadeEnvelope['candidates']['alsoConsidered'][number]): string {
  const title = c.url
    ? `<a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.headline)} <span class="made-glyph-teal" aria-hidden="true">↗</span></a>`
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
