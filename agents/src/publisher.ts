import { Agent } from 'agents';
import type { Env } from './types';

export interface PublishResult {
  published: boolean;
  filePath: string;
  commitSha: string;
  commitUrl: string;
}

interface PublisherState {
  lastPublish: PublishResult | null;
}

const REPO_OWNER = 'zzeeshann';
const REPO_NAME = 'daylila';
const BRANCH = 'main';

/**
 * PublisherAgent — commits approved MDX files to the GitHub repo.
 *
 * HARD RULE: never overwrites the CONTENT of a published piece.
 * `publishToPath` refuses to commit over an existing file.
 *
 * Metadata carve-out: `publishAudio` updates frontmatter only
 * (audioBeats map). Frontmatter metadata (voiceScore, qualityFlag,
 * audioBeats) is not "content" — it's plumbing the reader never
 * reads as teaching. The piece's beats, narrative, and facts stay
 * permanent.
 */
export class PublisherAgent extends Agent<Env, PublisherState> {
  initialState: PublisherState = { lastPublish: null };

  /** Publish to a specific file path (daily pieces) */
  async publishToPath(filePath: string, mdx: string, commitMessage: string): Promise<PublishResult> {
    // HARD RULE: published content is permanent. Never overwrite.
    const existingSha = await this.getFileSha(filePath);
    if (existingSha) {
      throw new Error(`Refused to overwrite published piece: ${filePath}`);
    }

    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'zeemish-agents',
        },
        body: JSON.stringify({
          message: commitMessage,
          content: btoa(unescape(encodeURIComponent(mdx))),
          branch: BRANCH,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      commit: { sha: string; html_url: string };
      content: { path: string };
    };

    const result: PublishResult = {
      published: true,
      filePath: data.content.path,
      commitSha: data.commit.sha,
      commitUrl: data.commit.html_url,
    };

    this.setState({ lastPublish: result });
    return result;
  }

  /**
   * Delete an interactive file from the repo. Used by Director's
   * `regenerateInteractive` flow — operator wants to wipe a Rough or
   * stale interactive's file so a fresh generation can commit to the
   * same slug.
   *
   * SAFETY: scoped to `content/interactives/` only. Daily pieces are
   * permanent; this method refuses to touch anything outside the
   * interactives directory at the API surface, not via prompt
   * convention. Returning success on a 404 lets regen flows be
   * idempotent against partial-state cleanups (D1 row deleted but
   * file already gone, or vice versa).
   */
  async deleteInteractiveFile(filePath: string, commitMessage: string): Promise<void> {
    if (!filePath.startsWith('content/interactives/')) {
      throw new Error(
        `deleteInteractiveFile refused: ${filePath} is not under content/interactives/. ` +
        `Daily-piece files are permanent.`,
      );
    }

    const sha = await this.getFileSha(filePath);
    if (!sha) {
      // File already gone — no-op for idempotent regen.
      return;
    }

    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'zeemish-agents',
        },
        body: JSON.stringify({
          message: commitMessage,
          sha,
          branch: BRANCH,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub DELETE failed for ${filePath} (${response.status}): ${error}`);
    }
  }

  /**
   * Second commit: splice an `audioBeats` YAML block into a published
   * piece's frontmatter. Expects the file to already exist (the
   * opposite of publishToPath). Idempotent — re-running with the same
   * audioBeats is a no-op commit (returns current sha).
   *
   * Updates only frontmatter metadata. Body content stays byte-for-byte
   * identical.
   */
  async publishAudio(
    filePath: string,
    audioBeats: Record<string, string>,
  ): Promise<PublishResult> {
    const current = await this.getFileContent(filePath);
    if (!current) {
      throw new Error(`publishAudio: file not found at ${filePath}. Text commit may have failed or path is wrong.`);
    }

    const updatedMdx = spliceAudioBeats(current.mdx, audioBeats);

    // Idempotent retry — identical audioBeats already spliced. Return
    // current sha so Director's observer event still gets a useful URL.
    if (updatedMdx === current.mdx) {
      const result: PublishResult = {
        published: false,
        filePath,
        commitSha: current.sha,
        commitUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${current.sha}`,
      };
      this.setState({ lastPublish: result });
      return result;
    }

    const commitMessage = `feat(daily): audio for ${filePath.split('/').pop()?.replace(/\.mdx$/, '') ?? 'piece'}`;
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'zeemish-agents',
        },
        body: JSON.stringify({
          message: commitMessage,
          content: btoa(unescape(encodeURIComponent(updatedMdx))),
          sha: current.sha,
          branch: BRANCH,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error on audio commit (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      commit: { sha: string; html_url: string };
      content: { path: string };
    };

    const result: PublishResult = {
      published: true,
      filePath: data.content.path,
      commitSha: data.commit.sha,
      commitUrl: data.commit.html_url,
    };
    this.setState({ lastPublish: result });
    return result;
  }

  /** Check if a file exists in the repo */
  private async getFileSha(filePath: string): Promise<string | null> {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${BRANCH}`,
      {
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'zeemish-agents',
        },
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) return null;

    const data = await response.json() as { sha: string };
    return data.sha;
  }

  /**
   * Public wrapper around getFileContent. Used by Director.retryAudio
   * to pull the committed MDX before re-running the audio pipeline.
   * Returns null on 404 (piece was deleted from the repo).
   */
  async readPublishedMdx(filePath: string): Promise<{ mdx: string; sha: string } | null> {
    return this.getFileContent(filePath);
  }

  /**
   * Fetch a file's current content + sha from GitHub. Returns null on
   * 404. Decodes base64 as UTF-8 via TextDecoder (safe for non-ASCII).
   */
  private async getFileContent(filePath: string): Promise<{ mdx: string; sha: string } | null> {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${BRANCH}`,
      {
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'zeemish-agents',
        },
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub GET failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
      sha: string;
      content: string;
      encoding: string;
    };

    const b64 = data.content.replace(/\n/g, '');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const mdx = new TextDecoder('utf-8').decode(bytes);
    return { mdx, sha: data.sha };
  }
}

/**
 * Splice an `audioBeats:` YAML block into the MDX frontmatter.
 *
 * - Removes any pre-existing `audioBeats:` block first (idempotent
 *   retry support — Director may re-run audio after a partial
 *   failure).
 * - Inserts the fresh block immediately before the closing `---`.
 * - Uses 2-space indentation and JSON-encoded (double-quoted) URLs
 *   so YAML parsing is unambiguous regardless of URL characters.
 * - Keys are emitted in the order of Object.entries, which preserves
 *   the producer's beat-order iteration — natural playback order.
 */
function spliceAudioBeats(mdx: string, audioBeats: Record<string, string>): string {
  // Strip any existing audioBeats block: the line itself plus any
  // following indented (2-space) lines. Stops at the next unindented
  // line (either another frontmatter key or the closing ---).
  //
  // Capture the leading `\n` in group 1 and restore it. Earlier shape
  // (`/\naudioBeats:\n(?:  .+\n)*/ → ''`) consumed the newline, so
  // `qualityFlag: "low"\naudioBeats:\n...\n---\n` became
  // `qualityFlag: "low"---\n` — the downstream splice regex then
  // couldn't find `\n---\n`, became a no-op, and publishAudio's
  // idempotent guard (updatedMdx === current.mdx) skipped over a
  // stripped-but-not-respliced file. Result: 2026-04-17 frontmatter
  // corruption. Verified by agents/scripts/verify-splice.mjs.
  const withoutExisting = mdx.replace(/(\n)audioBeats:\n(?:  .+\n)*/, '$1');

  const lines = Object.entries(audioBeats).map(
    ([key, url]) => `  ${key}: ${JSON.stringify(url)}`,
  );
  const block = `\naudioBeats:\n${lines.join('\n')}`;

  // Splice before the closing `---` of the frontmatter. Same regex
  // Drafter + Director use for other frontmatter inserts. Callback
  // form (returning a plain string) so any `$N` token that ever lands
  // in `block` (audio URL, key) cannot expand into a capture-group
  // backreference. See DECISIONS 2026-05-09 — that exact failure mode
  // corrupted the PM piece's frontmatter via the Director's claimReviews
  // splice; mirrored here defensively.
  return withoutExisting.replace(
    /^(---\n[\s\S]*?)(\n---\n)/,
    (_m, p1, p2) => `${p1}${block}${p2}`,
  );
}
