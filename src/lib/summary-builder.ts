/**
 * Summary prompt builder.
 *
 * Given the extracted page content and a target length (brief / medium /
 * detailed), produces a single user-message string that instructs the LLM to
 * summarise at that exact depth. The three levels map to the slider in the UI:
 *
 *   brief    — exactly 3 bullet points
 *   medium   — 1 paragraph + 5 bullet points
 *   detailed — 3 paragraphs + 3 key quotes (verbatim) from the source
 *
 * The system prompt that wraps this user message lives in `ai.ts`
 * (`SUMMARY_SYSTEM_PROMPT`) so the summariser's persona and constraints are
 * defined once and shared across all three lengths.
 */

export type SummaryLength = 'brief' | 'medium' | 'detailed'

export interface LengthSpec {
  length: SummaryLength
  /** Short human label shown next to the slider. */
  label: string
  /** One-line instruction embedded in the prompt. */
  instruction: string
  /** Full formatting directive embedded in the prompt. */
  format: string
  /** Slider position (1..3). */
  level: number
}

export const LENGTH_SPECS: LengthSpec[] = [
  {
    length: 'brief',
    label: 'Brief',
    instruction: '3 bullet points',
    format:
      'Format: exactly 3 bullet points (use "- " markdown bullets). ' +
      'Each bullet must be a single self-contained sentence.',
    level: 1,
  },
  {
    length: 'medium',
    label: 'Medium',
    instruction: '1 paragraph followed by 5 bullet points',
    format:
      'Format: 1 concise paragraph (3-5 sentences) summarising the whole content, ' +
      'followed by a bulleted list of exactly 5 key points (use "- " markdown bullets).',
    level: 2,
  },
  {
    length: 'detailed',
    label: 'Detailed',
    instruction: '3 paragraphs followed by 3 key quotes from the source',
    format:
      'Format: 3 paragraphs covering the main argument, the supporting evidence, ' +
      'and the conclusion. After the paragraphs, list 3 key quotes copied verbatim ' +
      'from the source (use "> " markdown blockquote for each quote).',
    level: 3,
  },
]

export function getLengthSpec(length: SummaryLength): LengthSpec {
  return LENGTH_SPECS.find((s) => s.length === length) ?? LENGTH_SPECS[1]
}

export function getLengthSpecByLevel(level: number): LengthSpec {
  return LENGTH_SPECS.find((s) => s.level === level) ?? LENGTH_SPECS[1]
}

/**
 * Build the user-message prompt for a single summarisation request.
 * Returns a string (the user message); the API route pairs it with the
 * fixed SUMMARY_SYSTEM_PROMPT from `ai.ts`.
 */
export function buildSummaryPrompt(content: string, length: SummaryLength): string {
  const spec = getLengthSpec(length)
  const parts: string[] = []
  parts.push(`Summarise the content below at the "${spec.label}" length.`)
  parts.push(`Length requirement: ${spec.instruction}.`)
  parts.push(spec.format)
  parts.push('Stay faithful to the source. Do not add information that is not present in the content.')
  parts.push('Output only the summary — no preamble, no trailing commentary.')
  parts.push('')
  parts.push('--- CONTENT START ---')
  parts.push(content || '(empty content)')
  parts.push('--- CONTENT END ---')
  return parts.join('\n')
}
