/**
 * Page content extractor.
 *
 * Given a raw HTML string (as returned by `fetch(url).text()`), extracts the
 * two pieces the summariser pipeline needs:
 *   - `title`    — from <title> (falls back to first <h1>)
 *   - `mainText` — the visible main body text with scripts/styles/navs/footers/
 *                  headers/asides/iforms/iframes stripped, HTML tags removed,
 *                  entities decoded, whitespace collapsed, truncated to 20k chars
 *
 * This module is PURE (no IO, no globals) so it can be unit-tested in
 * isolation. We deliberately avoid a full HTML parser dependency — the
 * extractor uses targeted regexes which are sufficient for the MVP and keep
 * the bundle tiny. (A real Readability.js pass is a documented stretch goal.)
 */

export interface ExtractedPage {
  title: string
  mainText: string
}

const MAX_MAIN_TEXT_CHARS = 20000

/** Tags whose entire subtree we drop (including content). */
const DROP_TAGS = [
  'script', 'style', 'noscript', 'template', 'nav', 'footer', 'header',
  'aside', 'svg', 'form', 'iframe', 'button',
]

/** Decode a minimal set of named entities + numeric entities. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

/** Strip an entire element subtree: `<tag ...>...</tag>` (case-insensitive, non-greedy, dotall). */
function stripElement(html: string, tag: string): string {
  let prev: string
  let out = html
  do {
    prev = out
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '')
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '')
    out = out.replace(new RegExp(`</${tag}>`, 'gi'), '')
  } while (out !== prev)
  out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '')
  out = out.replace(new RegExp(`</${tag}>`, 'gi'), '')
  return out
}

/** Remove all HTML tags (keep the inner text). */
function stripAllTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ')
}

/** Extract <title>...</title>, falling back to first <h1>. */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (m) return decodeEntities(m[1]).trim()
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) return stripAllTags(decodeEntities(h1[1])).replace(/\s+/g, ' ').trim()
  return ''
}

export function extractPageContent(html: string): ExtractedPage {
  const empty: ExtractedPage = { title: '', mainText: '' }
  if (!html || typeof html !== 'string' || html.trim().length === 0) return empty

  // 1. Pull title BEFORE stripping tag subtrees, so a <title> inside <head>
  //    survives (head isn't in DROP_TAGS but <header> is — case-insensitive).
  const title = extractTitle(html)

  // 2. Drop the noisy subtrees (scripts, styles, navs, footers, etc.).
  let body = html
  for (const tag of DROP_TAGS) {
    body = stripElement(body, tag)
  }
  body = body.replace(/<!--[\s\S]*?-->/g, ' ')

  // 3. Strip remaining tags, decode entities, collapse whitespace.
  let text = stripAllTags(body)
  text = decodeEntities(text)
  text = text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/^[ \t]+/gm, '')
    .trim()

  // 4. Truncate to the first 20k chars (on a word boundary when possible).
  if (text.length > MAX_MAIN_TEXT_CHARS) {
    const slice = text.slice(0, MAX_MAIN_TEXT_CHARS)
    const lastSpace = slice.lastIndexOf(' ')
    text = (lastSpace > MAX_MAIN_TEXT_CHARS * 0.8 ? slice.slice(0, lastSpace) : slice).trim() + '…'
  }

  return { title, mainText: text }
}
