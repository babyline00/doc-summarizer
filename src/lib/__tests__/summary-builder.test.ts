import { test, expect, describe } from 'bun:test'
import {
  buildSummaryPrompt,
  getLengthSpec,
  getLengthSpecByLevel,
  LENGTH_SPECS,
  type SummaryLength,
} from '../summary-builder'

describe('buildSummaryPrompt', () => {
  test('brief length asks for 3 bullets', () => {
    const p = buildSummaryPrompt('content here', 'brief')
    expect(p.toLowerCase()).toContain('3 bullet')
  })

  test('brief does NOT mention paragraphs or quotes', () => {
    const p = buildSummaryPrompt('content here', 'brief')
    expect(p.toLowerCase()).not.toContain('paragraph')
    expect(p.toLowerCase()).not.toContain('quote')
  })

  test('medium length asks for 1 paragraph + 5 bullets', () => {
    const p = buildSummaryPrompt('content here', 'medium')
    expect(p.toLowerCase()).toContain('1 paragraph')
    expect(p.toLowerCase()).toContain('5 bullet')
  })

  test('detailed length asks for 3 paragraphs + key quotes', () => {
    const p = buildSummaryPrompt('content here', 'detailed')
    expect(p.toLowerCase()).toContain('3 paragraphs')
    expect(p.toLowerCase()).toContain('key quotes')
  })

  test('always includes the content', () => {
    const p = buildSummaryPrompt('UNIQUE_CONTENT_TOKEN', 'medium')
    expect(p).toContain('UNIQUE_CONTENT_TOKEN')
  })

  test('includes the human-readable length label', () => {
    expect(buildSummaryPrompt('c', 'brief')).toContain('Brief')
    expect(buildSummaryPrompt('c', 'medium')).toContain('Medium')
    expect(buildSummaryPrompt('c', 'detailed')).toContain('Detailed')
  })

  test('handles empty content gracefully', () => {
    const p = buildSummaryPrompt('', 'brief')
    expect(p.toLowerCase()).toContain('empty content')
  })

  test('the three length prompts are mutually distinct', () => {
    const brief = buildSummaryPrompt('same content', 'brief')
    const medium = buildSummaryPrompt('same content', 'medium')
    const detailed = buildSummaryPrompt('same content', 'detailed')
    expect(brief).not.toBe(medium)
    expect(medium).not.toBe(detailed)
    expect(brief).not.toBe(detailed)
  })
})

describe('LENGTH_SPECS / getLengthSpec', () => {
  test('has exactly 3 specs in brief/medium/detailed order', () => {
    expect(LENGTH_SPECS).toHaveLength(3)
    expect(LENGTH_SPECS.map((s) => s.length)).toEqual(['brief', 'medium', 'detailed'])
  })

  test('levels are 1, 2, 3', () => {
    expect(LENGTH_SPECS.map((s) => s.level)).toEqual([1, 2, 3])
  })

  test('getLengthSpec returns the right spec for each length', () => {
    expect(getLengthSpec('brief').length).toBe('brief')
    expect(getLengthSpec('medium').length).toBe('medium')
    expect(getLengthSpec('detailed').length).toBe('detailed')
  })

  test('getLengthSpec falls back to medium for unknown length', () => {
    expect(getLengthSpec('unknown' as SummaryLength).length).toBe('medium')
  })

  test('getLengthSpecByLevel returns the right spec per slider level', () => {
    expect(getLengthSpecByLevel(1).length).toBe('brief')
    expect(getLengthSpecByLevel(2).length).toBe('medium')
    expect(getLengthSpecByLevel(3).length).toBe('detailed')
  })

  test('getLengthSpecByLevel falls back to medium for out-of-range level', () => {
    expect(getLengthSpecByLevel(0).length).toBe('medium')
    expect(getLengthSpecByLevel(99).length).toBe('medium')
  })
})
