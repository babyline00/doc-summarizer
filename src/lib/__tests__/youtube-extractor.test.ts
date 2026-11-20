import { test, expect, describe } from 'bun:test'
import { extractVideoId } from '../youtube-extractor'

const ID = 'dQw4w9WgXcQ'

describe('extractVideoId', () => {
  test('parses watch?v= URL', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
  })
  test('parses watch URL with extra query params', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s&feature=share`)).toBe(ID)
  })
  test('parses youtu.be short URL', () => {
    expect(extractVideoId(`https://youtu.be/${ID}`)).toBe(ID)
  })
  test('parses youtu.be short URL with query params', () => {
    expect(extractVideoId(`https://youtu.be/${ID}?si=abc123`)).toBe(ID)
  })
  test('parses /embed/ URL', () => {
    expect(extractVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
  })
  test('parses /shorts/ URL', () => {
    expect(extractVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
  })
  test('parses m.youtube.com watch URL', () => {
    expect(extractVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID)
  })
  test('parses youtube-nocookie embed URL', () => {
    expect(extractVideoId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID)
  })
  test('parses legacy /v/ URL', () => {
    expect(extractVideoId(`https://www.youtube.com/v/${ID}`)).toBe(ID)
  })
  test('parses bare 11-char ID', () => {
    expect(extractVideoId(ID)).toBe(ID)
  })
  test('returns null for non-youtube url', () => {
    expect(extractVideoId('https://example.com/watch?v=abc')).toBeNull()
  })
  test('returns null for empty string', () => {
    expect(extractVideoId('')).toBeNull()
  })
  test('returns null for whitespace-only', () => {
    expect(extractVideoId('   ')).toBeNull()
  })
  test('returns null for a too-short id', () => {
    expect(extractVideoId('abc123')).toBeNull()
  })
  test('returns null for non-string input', () => {
    expect(extractVideoId(null as unknown as string)).toBeNull()
    expect(extractVideoId(undefined as unknown as string)).toBeNull()
  })
  test('trims surrounding whitespace before parsing', () => {
    expect(extractVideoId(`  https://youtu.be/${ID}  `)).toBe(ID)
  })
})
