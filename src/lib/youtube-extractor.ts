/**
 * YouTube URL → video ID parser.
 *
 * Supports the four canonical YouTube URL shapes plus a bare-ID fallback:
 *   - https://www.youtube.com/watch?v=ID  (also with extra query params)
 *   - https://youtu.be/ID
 *   - https://www.youtube.com/embed/ID
 *   - https://www.youtube.com/shorts/ID
 *   - https://www.youtube.com/v/ID          (legacy embed)
 *   - https://www.youtube-nocookie.com/embed/ID
 *   - bare 11-char ID
 *
 * YouTube video IDs are exactly 11 chars from [A-Za-z0-9_-].
 *
 * This module is PURE (no IO, no globals) so it can be unit-tested in
 * isolation. The actual transcript fetch happens in the API route via the
 * `youtube-transcript` package (Project #13's pattern).
 */

const ID_PATTERN = '[A-Za-z0-9_-]{11}'

const PATTERNS: RegExp[] = [
  new RegExp(`[?&]v=(${ID_PATTERN})`),            // watch?v=ID
  new RegExp(`youtu\\.be/(${ID_PATTERN})`),       // youtu.be/ID
  new RegExp(`youtube\\.com/embed/(${ID_PATTERN})`), // /embed/ID
  new RegExp(`youtube\\.com/shorts/(${ID_PATTERN})`), // /shorts/ID
  new RegExp(`youtube\\.com/v/(${ID_PATTERN})`),  // /v/ID (legacy)
  new RegExp(`youtube-nocookie\\.com/embed/(${ID_PATTERN})`), // nocookie embed
  new RegExp(`m\\.youtube\\.com/watch\\?v=(${ID_PATTERN})`),  // m.youtube.com
]

export function extractVideoId(url: string): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null

  for (const re of PATTERNS) {
    const m = trimmed.match(re)
    if (m) return m[1]
  }

  // Bare 11-char ID
  if (new RegExp(`^${ID_PATTERN}$`).test(trimmed)) return trimmed

  return null
}
