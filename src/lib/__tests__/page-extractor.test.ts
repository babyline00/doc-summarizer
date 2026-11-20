import { test, expect, describe } from 'bun:test'
import { extractPageContent } from '../page-extractor'

describe('extractPageContent — simple page', () => {
  test('extracts title and main text', () => {
    const html = `<html><head><title>React Docs — Hooks</title></head><body>
      <h1>React Hooks</h1>
      <p>Hooks let you use state in function components.</p>
      <p>useState and useEffect are the most common hooks.</p>
    </body></html>`
    const r = extractPageContent(html)
    expect(r.title).toBe('React Docs — Hooks')
    expect(r.mainText).toContain('React Hooks')
    expect(r.mainText).toContain('useState and useEffect')
  })

  test('strips scripts and styles', () => {
    const html = `<html><head><title>Page</title>
      <style>body { color: red; } .nav { display: none; }</style>
      <script>console.log('leak'); var x = 'should not appear';</script>
      </head><body><p>visible text</p></body></html>`
    const r = extractPageContent(html)
    expect(r.mainText).toContain('visible text')
    expect(r.mainText).not.toContain('leak')
    expect(r.mainText).not.toContain('should not appear')
    expect(r.mainText).not.toContain('color: red')
  })

  test('strips nav and footer subtrees', () => {
    const html = `<html><head><title>Article</title></head><body>
      <nav><a>Home</a><a>About</a>menu noise here</nav>
      <main><article><p>The main article body about topic.</p></article></main>
      <footer>copyright 2025 footer noise</footer>
      </body></html>`
    const r = extractPageContent(html)
    expect(r.mainText).toContain('main article body')
    expect(r.mainText).not.toContain('menu noise')
    expect(r.mainText).not.toContain('footer noise')
  })
})

describe('extractPageContent — no-meta / no-title page', () => {
  test('falls back to first h1 when title tag missing', () => {
    const html = `<html><body><h1>Heading Title</h1><p>body text</p></body></html>`
    const r = extractPageContent(html)
    expect(r.title).toBe('Heading Title')
    expect(r.mainText).toContain('body text')
  })

  test('returns empty title when no title and no h1', () => {
    const html = `<html><body><p>just a paragraph</p></body></html>`
    const r = extractPageContent(html)
    expect(r.title).toBe('')
    expect(r.mainText).toContain('just a paragraph')
  })

  test('page without any meta description still yields main text (no-meta case)', () => {
    const html = `<html><head><title>No Meta Page</title></head><body>
      <article><p>This is the article body without any meta tags.</p></article>
      </body></html>`
    const r = extractPageContent(html)
    expect(r.title).toBe('No Meta Page')
    expect(r.mainText).toContain('article body without any meta tags')
  })
})

describe('extractPageContent — empty / edge inputs', () => {
  test('empty string -> all empty', () => {
    expect(extractPageContent('')).toEqual({ title: '', mainText: '' })
  })
  test('whitespace-only -> all empty', () => {
    const r = extractPageContent('   \n\t  ')
    expect(r.title).toBe('')
    expect(r.mainText).toBe('')
  })
  test('null -> empty', () => {
    const r = extractPageContent(null as unknown as string)
    expect(r).toEqual({ title: '', mainText: '' })
  })
  test('decodes common HTML entities', () => {
    const html = `<html><head><title>Tom &amp; Jerry &quot;quotes&quot;</title></head>
      <body><p>5 &lt; 10 &amp; 20 &gt; 10</p></body></html>`
    const r = extractPageContent(html)
    expect(r.title).toBe('Tom & Jerry "quotes"')
    expect(r.mainText).toContain('5 < 10 & 20 > 10')
  })
  test('truncates very long main text', () => {
    const long = 'word '.repeat(20000) // ~100k chars
    const html = `<html><head><title>Long</title></head><body><p>${long}</p></body></html>`
    const r = extractPageContent(html)
    expect(r.mainText.length).toBeLessThanOrEqual(20200)
    expect(r.mainText.length).toBeGreaterThan(15000)
    expect(r.mainText.endsWith('…')).toBe(true)
  })
})
