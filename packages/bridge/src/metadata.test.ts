import { describe, it, expect } from 'vitest'
import { parseMetadata, serializeMetadata } from './metadata.js'

describe('parseMetadata', () => {
  it('parses valid metadata from a note body', () => {
    const body = `## Level 1 Preview
+3 resources
<!-- ig-meta:{"level":1,"workspaces":["docker-network","redis"],"planId":"abc123"} -->`

    const result = parseMetadata(body)
    expect(result).toEqual({
      level: 1,
      workspaces: ['docker-network', 'redis'],
      planId: 'abc123',
    })
  })

  it('parses metadata embedded in the middle of content', () => {
    const body = `Some text before
<!-- ig-meta:{"level":2,"workspaces":["postgres"],"planId":"def456"} -->
Some text after`

    const result = parseMetadata(body)
    expect(result).toEqual({
      level: 2,
      workspaces: ['postgres'],
      planId: 'def456',
    })
  })

  it('returns null when no metadata comment exists', () => {
    const body = '## Just a regular comment\nNo metadata here.'
    expect(parseMetadata(body)).toBeNull()
  })

  it('returns null for empty body', () => {
    expect(parseMetadata('')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    const body = '<!-- ig-meta:{not valid json} -->'
    expect(parseMetadata(body)).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    const body = '<!-- ig-meta:{"level":1} -->'
    expect(parseMetadata(body)).toBeNull()
  })

  it('returns null when level is not a positive integer', () => {
    const body = '<!-- ig-meta:{"level":0,"workspaces":["a"],"planId":"x"} -->'
    expect(parseMetadata(body)).toBeNull()
  })

  it('returns null when level is negative', () => {
    const body = '<!-- ig-meta:{"level":-1,"workspaces":["a"],"planId":"x"} -->'
    expect(parseMetadata(body)).toBeNull()
  })

  it('returns null when workspaces is empty', () => {
    const body = '<!-- ig-meta:{"level":1,"workspaces":[],"planId":"x"} -->'
    expect(parseMetadata(body)).toBeNull()
  })

  it('returns null when planId is empty', () => {
    const body = '<!-- ig-meta:{"level":1,"workspaces":["a"],"planId":""} -->'
    expect(parseMetadata(body)).toBeNull()
  })

  it('parses metadata with commitSha', () => {
    const body = '<!-- ig-meta:{"level":1,"workspaces":["a"],"planId":"x","commitSha":"abc123def"} -->'
    const result = parseMetadata(body)
    expect(result).toEqual({
      level: 1,
      workspaces: ['a'],
      planId: 'x',
      commitSha: 'abc123def',
    })
  })

  it('parses metadata without commitSha (backward compat)', () => {
    const body = '<!-- ig-meta:{"level":1,"workspaces":["a"],"planId":"x"} -->'
    const result = parseMetadata(body)
    expect(result).toEqual({
      level: 1,
      workspaces: ['a'],
      planId: 'x',
    })
    expect(result?.commitSha).toBeUndefined()
  })

  it('extracts only the first metadata comment if multiple exist', () => {
    const body = `<!-- ig-meta:{"level":1,"workspaces":["a"],"planId":"first"} -->
<!-- ig-meta:{"level":2,"workspaces":["b"],"planId":"second"} -->`

    const result = parseMetadata(body)
    expect(result?.planId).toBe('first')
  })
})

describe('serializeMetadata', () => {
  it('produces a valid HTML comment', () => {
    const result = serializeMetadata({
      level: 1,
      workspaces: ['docker-network', 'redis'],
      planId: 'abc123',
    })
    expect(result).toBe('<!-- ig-meta:{"level":1,"workspaces":["docker-network","redis"],"planId":"abc123"} -->')
  })

  it('round-trips through parse', () => {
    const original = { level: 3, workspaces: ['ws-a', 'ws-b'], planId: 'plan-xyz' }
    const serialized = serializeMetadata(original)
    const parsed = parseMetadata(serialized)
    expect(parsed).toEqual(original)
  })

  it('round-trips with commitSha', () => {
    const original = { level: 1, workspaces: ['ws-a'], planId: 'plan-1', commitSha: 'sha256abc' }
    const serialized = serializeMetadata(original)
    const parsed = parseMetadata(serialized)
    expect(parsed).toEqual(original)
  })
})
