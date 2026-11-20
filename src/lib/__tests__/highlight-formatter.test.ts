import { test, expect, describe } from 'bun:test'
import { formatHighlightForUi } from '../highlight-formatter'

describe('formatHighlightForUi', () => {
  test('returns pageUrl + pageTitle when the page relation is loaded', () => {
    const out = formatHighlightForUi({
      id: 'h1',
      text: 'important quote',
      note: 'remember this',
      pageId: 'p1',
      page: { id: 'p1', title: 'React Hooks', url: 'https://example.com/hooks' },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    expect(out.id).toBe('h1')
    expect(out.text).toBe('important quote')
    expect(out.note).toBe('remember this')
    expect(out.pageId).toBe('p1')
    expect(out.pageUrl).toBe('https://example.com/hooks')
    expect(out.pageTitle).toBe('React Hooks')
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  test('returns nulls for pageUrl/pageTitle when page is null', () => {
    const out = formatHighlightForUi({
      id: 'h2',
      text: 'orphan quote',
      note: null,
      pageId: null,
      page: null,
      createdAt: '2026-02-02T00:00:00Z',
    })
    expect(out.pageId).toBeNull()
    expect(out.pageUrl).toBeNull()
    expect(out.pageTitle).toBeNull()
    expect(out.note).toBeNull()
    expect(out.createdAt).toBe('2026-02-02T00:00:00Z')
  })

  test('handles missing page relation gracefully (pageId set but page undefined)', () => {
    const out = formatHighlightForUi({
      id: 'h3',
      text: 'x',
      note: null,
      pageId: 'p3',
      page: undefined,
      createdAt: new Date('2026-03-03T00:00:00Z'),
    })
    expect(out.pageId).toBe('p3')
    expect(out.pageUrl).toBeNull()
    expect(out.pageTitle).toBeNull()
  })

  test('passes the note through unchanged', () => {
    const out = formatHighlightForUi({
      id: 'h4',
      text: 'quote with note',
      note: 'my note',
      pageId: null,
      page: null,
      createdAt: new Date(),
    })
    expect(out.note).toBe('my note')
  })

  test('serializes a Date createdAt to ISO string', () => {
    const d = new Date('2026-05-05T12:34:56Z')
    const out = formatHighlightForUi({
      id: 'h5',
      text: 't',
      note: null,
      pageId: null,
      page: null,
      createdAt: d,
    })
    expect(out.createdAt).toBe(d.toISOString())
  })

  test('passes a string createdAt through unchanged', () => {
    const out = formatHighlightForUi({
      id: 'h6',
      text: 't',
      note: null,
      pageId: null,
      page: null,
      createdAt: '2026-06-06T00:00:00Z',
    })
    expect(out.createdAt).toBe('2026-06-06T00:00:00Z')
  })

  test('returns a plain object with exactly the FormattedHighlight shape', () => {
    const out = formatHighlightForUi({
      id: 'h7',
      text: 't',
      note: 'n',
      pageId: 'p7',
      page: { id: 'p7', title: 'T', url: 'u' },
      createdAt: new Date(),
    })
    const keys = Object.keys(out).sort()
    expect(keys).toEqual(
      ['createdAt', 'id', 'note', 'pageId', 'pageTitle', 'pageUrl', 'text'].sort(),
    )
  })
})
