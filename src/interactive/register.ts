/**
 * Registers all lesson Web Components.
 * Import this file on any page that uses <lesson-shell> and <lesson-beat>.
 *
 * Includes quiz-card + interactive-frame as of Area 5: the companion
 * interactive embeds inline at the bottom of the daily piece page.
 */
import './lesson-beat';
import './lesson-shell';
import './lesson-progress';
import './lesson-swipe';
import './audio-player';
import './zita-chat';
import './made-drawer';
import './quiz-card';
import './interactive-frame';
// In-beat MDX widgets (PR #3, 2026-05-09). Drafter uses these only
// when the beat earns a widget — most beats stay pure prose. See the
// "When a beat earns a widget" section in agents/src/drafter-prompt.ts.
import './reveal';
import './compare';
import './callout';
