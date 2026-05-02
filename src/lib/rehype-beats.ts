/**
 * rehype-beats — wraps MDX h2-demarcated sections in
 * <lesson-shell> / <lesson-beat> so the existing Web Component
 * (src/interactive/lesson-shell.ts) can take over beat-by-beat
 * navigation.
 *
 * Input shape (MDX as authored by Drafter):
 *   ## hook
 *   Paragraph...
 *
 *   ## what-is-hormuz
 *   Paragraph...
 *
 * Output shape (after this plugin runs):
 *   <lesson-shell>
 *     <lesson-beat name="hook">
 *       <h2>Hook</h2>
 *       <p>...</p>
 *     </lesson-beat>
 *     <lesson-beat name="what-is-hormuz">
 *       <h2>What Is Hormuz</h2>
 *       <p>...</p>
 *     </lesson-beat>
 *   </lesson-shell>
 *
 * Behaviour:
 * - Headings authored in kebab-case (`## hook`) are humanised for
 *   display; headings that already look human-readable are kept as-is.
 * - Optional `beatTitles` frontmatter map overrides humanize() per slug
 *   for acronyms and punctuation the kebab form can't express
 *   (e.g. `qvcs-original-advantage` → "QVC's Original Advantage").
 * - Content appearing before the first h2 is folded into the first beat
 *   so nothing is lost.
 * - No-op when the MDX has no h2 headings — legacy or intro-only
 *   pieces render as regular prose.
 */

interface HastElement {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
}

interface HastText {
  type: 'text';
  value: string;
}

type HastNode = HastElement | HastText | { type: string; children?: HastNode[] };

interface HastRoot {
  type: 'root';
  children: HastNode[];
}

interface VFile {
  data?: {
    astro?: {
      frontmatter?: Record<string, unknown>;
    };
  };
}

function extractText(node: HastNode): string {
  if (!node) return '';
  if (node.type === 'text') return (node as HastText).value ?? '';
  const el = node as HastElement;
  if (el.children) return el.children.map(extractText).join('');
  return '';
}

function humanize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

export default function rehypeBeats() {
  return (tree: HastRoot, file: VFile) => {
    const children = tree.children;
    const h2Indices: number[] = [];

    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.type === 'element' && (node as HastElement).tagName === 'h2') {
        h2Indices.push(i);
      }
    }

    if (h2Indices.length === 0) return;

    const fm = file?.data?.astro?.frontmatter;
    const beatTitles =
      fm && typeof fm.beatTitles === 'object' && fm.beatTitles !== null
        ? (fm.beatTitles as Record<string, string>)
        : undefined;
    // piece_id flows from frontmatter to `<lesson-shell data-piece-id>`
    // so the web component can attribute engagement events per-piece
    // rather than per-piece_date (which collides at multi-per-day).
    // Added Phase 7 engagement piece_id wiring (2026-04-22).
    const pieceId = fm && typeof fm.pieceId === 'string' ? fm.pieceId : undefined;

    const preContent = children.slice(0, h2Indices[0]);
    const beats: HastElement[] = [];

    for (let i = 0; i < h2Indices.length; i++) {
      const start = h2Indices[i];
      const end = i + 1 < h2Indices.length ? h2Indices[i + 1] : children.length;
      const segment = children.slice(start, end);

      const h2Node = segment[0] as HastElement;
      const rawName = extractText(h2Node).trim();

      const isKebabOnly = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(rawName);
      const slugKey = isKebabOnly ? rawName : slugify(rawName);
      const override = beatTitles?.[slugKey];
      const displayTitle = override ?? (isKebabOnly ? humanize(rawName) : rawName);
      h2Node.children = [{ type: 'text', value: displayTitle } as HastText];

      const name = slugKey;

      const beatChildren = i === 0 ? [...preContent, ...segment] : segment;

      beats.push({
        type: 'element',
        tagName: 'lesson-beat',
        properties: { name, id: name },
        children: beatChildren,
      });
    }

    const shell: HastElement = {
      type: 'element',
      tagName: 'lesson-shell',
      properties: pieceId ? { 'data-piece-id': pieceId } : {},
      children: beats,
    };

    tree.children = [shell];
  };
}
