/**
 * <zita-chat> — Socratic learning guide widget.
 *
 * A minimal chat interface that sits at the bottom of lesson pages.
 * Sends messages to /api/zita/chat with lesson context.
 * Displays Zita's short, question-driven responses.
 *
 * Attributes:
 *   course     - course slug (e.g. "daily", "body")
 *   lesson     - lesson number (e.g. "0", "3")
 *   piece-date - YYYY-MM-DD for daily pieces; required so conversations
 *                scope to the piece rather than pooling under
 *                (course='daily', lesson=0). Absent for legacy lessons.
 *   piece-id   - daily_pieces.id (UUID). Sent with POST so observer
 *                events (truncation, Claude errors, handler errors)
 *                scope to the piece instead of leaning on a 36h day
 *                window. Absent for legacy lessons.
 *   title      - piece / lesson title (for prompt context)
 */
class ZitaChat extends HTMLElement {
  private isOpen = false;
  private messages: Array<{ role: string; text: string }> = [];

  get course(): string { return this.getAttribute('course') ?? ''; }
  get lesson(): string { return this.getAttribute('lesson') ?? ''; }
  get pieceDate(): string { return this.getAttribute('piece-date') ?? ''; }
  get pieceId(): string { return this.getAttribute('piece-id') ?? ''; }
  get lessonTitle(): string { return this.getAttribute('title') ?? ''; }

  connectedCallback() {
    this.innerHTML = `
      <div class="zita-toggle">
        <button class="zita-toggle-btn" aria-label="Ask Zita">
          <svg class="zita-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </button>
      </div>
      <div class="zita-panel" style="display:none">
        <div class="zita-header">
          <span class="zita-name">Zita</span>
          <span class="zita-desc">Your learning guide</span>
          <button class="zita-close" aria-label="Close">×</button>
        </div>
        <div class="zita-messages">
          <div class="zita-msg zita-msg-assistant">
            What are you thinking about from this lesson?
          </div>
        </div>
        <form class="zita-input">
          <input type="text" placeholder="Ask something..." autocomplete="off" />
          <button type="submit" aria-label="Send">→</button>
        </form>
      </div>
    `;

    // Toggle open/close
    this.querySelector('.zita-toggle-btn')?.addEventListener('click', () => this.toggle());
    this.querySelector('.zita-close')?.addEventListener('click', () => this.toggle());

    // Submit message
    this.querySelector('.zita-input')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.querySelector('.zita-input input') as HTMLInputElement;
      if (input.value.trim()) {
        this.sendMessage(input.value.trim());
        input.value = '';
      }
    });
  }

  private toggle() {
    this.isOpen = !this.isOpen;
    const panel = this.querySelector('.zita-panel') as HTMLElement;
    const toggle = this.querySelector('.zita-toggle') as HTMLElement;
    if (this.isOpen) {
      if (panel) panel.style.display = 'flex';
      if (toggle) toggle.style.display = 'none';
      (this.querySelector('.zita-input input') as HTMLInputElement)?.focus();
    } else {
      if (panel) panel.style.display = 'none';
      if (toggle) toggle.style.display = 'block';
    }
  }

  private async sendMessage(text: string) {
    // Add user message to UI
    this.addMessageToUI('user', text);

    // Show typing indicator
    const typing = document.createElement('div');
    typing.className = 'zita-msg zita-msg-assistant zita-typing';
    typing.textContent = '...';
    this.querySelector('.zita-messages')?.appendChild(typing);
    this.scrollToBottom();

    try {
      const res = await fetch('/api/zita/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          course_slug: this.course,
          lesson_number: parseInt(this.lesson, 10),
          piece_date: this.pieceDate || null,
          piece_id: this.pieceId || null,
          lesson_title: this.lessonTitle,
        }),
      });

      typing.remove();

      if (res.ok) {
        const data = await res.json();
        this.addMessageToUI('assistant', data.reply);
      } else {
        this.addMessageToUI('assistant', 'Something went wrong. Try again?');
      }
    } catch {
      typing.remove();
      this.addMessageToUI('assistant', 'I\'m offline right now. Try again later.');
    }
  }

  private addMessageToUI(role: string, text: string) {
    const msg = document.createElement('div');
    msg.className = `zita-msg zita-msg-${role}`;
    msg.textContent = text;
    this.querySelector('.zita-messages')?.appendChild(msg);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    const container = this.querySelector('.zita-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

customElements.define('zita-chat', ZitaChat);

export { ZitaChat };
