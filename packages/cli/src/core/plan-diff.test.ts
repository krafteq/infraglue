import { computeDetailedDiff } from './plan-diff.js'
import { SENSITIVE_VALUE, UNKNOWN_AFTER_APPLY, diffAttributes } from './plan-diff.js'
import type { ResourceChange } from '../providers/provider-plan.js'

function makeResourceChange(overrides: Partial<ResourceChange> = {}): ResourceChange {
  return {
    address: 'aws_instance.example',
    type: 'aws_instance',
    name: 'example',
    actions: ['update'],
    status: 'pending',
    before: { ami: 'ami-old', instance_type: 't2.micro' },
    after: { ami: 'ami-new', instance_type: 't2.micro' },
    metadata: {},
    ...overrides,
  }
}

describe('computeDetailedDiff', () => {
  it('should identify real attribute diffs', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { ami: 'ami-old', instance_type: 't2.micro' },
        after: { ami: 'ami-new', instance_type: 't2.micro' },
      }),
    ])

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.resources[0].attributeDiffs).toMatchObject([
      { key: 'ami', kind: 'changed', before: 'ami-old', after: 'ami-new' },
    ])
    expect(result.realChangeCount).toBe(1)
    expect(result.metadataOnlyCount).toBe(0)
  })

  it('should label metadata-only when before === after on update', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { ami: 'ami-123', instance_type: 't2.micro' },
        after: { ami: 'ami-123', instance_type: 't2.micro' },
      }),
    ])

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0].isMetadataOnly).toBe(true)
    expect(result.resources[0].attributeDiffs).toEqual([])
    expect(result.metadataOnlyCount).toBe(1)
    expect(result.realChangeCount).toBe(0)
  })

  it('should handle create (before null) — not metadata-only', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        actions: ['create'],
        before: null,
        after: { ami: 'ami-new' },
      }),
    ])

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.resources[0].attributeDiffs).toEqual([])
    expect(result.realChangeCount).toBe(1)
  })

  it('should handle delete (after null) — not metadata-only', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        actions: ['delete'],
        before: { ami: 'ami-old' },
        after: null,
      }),
    ])

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.realChangeCount).toBe(1)
  })

  it('should handle nested objects', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { tags: { Name: 'old', Env: 'dev' } },
        after: { tags: { Name: 'new', Env: 'dev' } },
      }),
    ])

    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.resources[0].attributeDiffs).toMatchObject([
      { key: 'tags.Name', kind: 'changed', before: 'old', after: 'new' },
    ])
  })

  it('should handle identical nested objects as metadata-only', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { tags: { Name: 'same', Env: 'dev' } },
        after: { tags: { Name: 'same', Env: 'dev' } },
      }),
    ])

    expect(result.resources[0].isMetadataOnly).toBe(true)
    expect(result.resources[0].attributeDiffs).toEqual([])
  })

  it('should handle arrays', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { security_groups: ['sg-1', 'sg-2'] },
        after: { security_groups: ['sg-1', 'sg-3'] },
      }),
    ])

    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.resources[0].attributeDiffs).toHaveLength(1)
    expect(result.resources[0].attributeDiffs[0]).toMatchObject({
      key: 'security_groups[1]',
      kind: 'changed',
      before: 'sg-2',
      after: 'sg-3',
    })
  })

  it('should handle identical arrays as metadata-only', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { security_groups: ['sg-1', 'sg-2'] },
        after: { security_groups: ['sg-1', 'sg-2'] },
      }),
    ])

    expect(result.resources[0].isMetadataOnly).toBe(true)
  })

  it('should detect added keys', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { ami: 'ami-123' },
        after: { ami: 'ami-123', new_key: 'value' },
      }),
    ])

    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.resources[0].attributeDiffs).toMatchObject([
      { key: 'new_key', kind: 'added', before: undefined, after: 'value' },
    ])
  })

  it('should detect removed keys', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { ami: 'ami-123', old_key: 'value' },
        after: { ami: 'ami-123' },
      }),
    ])

    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.resources[0].attributeDiffs).toMatchObject([
      { key: 'old_key', kind: 'removed', before: 'value', after: undefined },
    ])
  })

  it('should aggregate counts across multiple resources', () => {
    const result = computeDetailedDiff([
      // Real change
      makeResourceChange({
        address: 'aws_instance.a',
        before: { ami: 'old' },
        after: { ami: 'new' },
      }),
      // Metadata-only
      makeResourceChange({
        address: 'aws_instance.b',
        before: { ami: 'same' },
        after: { ami: 'same' },
      }),
      // Create
      makeResourceChange({
        address: 'aws_instance.c',
        actions: ['create'],
        before: null,
        after: { ami: 'new' },
      }),
      // Another metadata-only
      makeResourceChange({
        address: 'aws_instance.d',
        before: { x: 1 },
        after: { x: 1 },
      }),
    ])

    expect(result.resources).toHaveLength(4)
    expect(result.metadataOnlyCount).toBe(2)
    expect(result.realChangeCount).toBe(2)
  })

  it('should return empty result for no resource changes', () => {
    const result = computeDetailedDiff([])

    expect(result.resources).toEqual([])
    expect(result.metadataOnlyCount).toBe(0)
    expect(result.realChangeCount).toBe(0)
  })

  it('should handle update with undefined before (missing from JSON)', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        actions: ['update'],
        before: undefined as unknown as Record<string, unknown> | null,
        after: { ami: 'ami-new' },
      }),
    ])

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.realChangeCount).toBe(1)
  })

  it('should handle update with undefined after (missing from JSON)', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        actions: ['update'],
        before: { ami: 'ami-old' },
        after: undefined as unknown as Record<string, unknown> | null,
      }),
    ])

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.realChangeCount).toBe(1)
  })

  it('should diff replace actions when before/after are available', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        actions: ['replace'],
        before: { ami: 'ami-old' },
        after: { ami: 'ami-new' },
      }),
    ])

    expect(result.resources[0].isMetadataOnly).toBe(false)
    expect(result.resources[0].attributeDiffs).toMatchObject([
      { key: 'ami', kind: 'changed', before: 'ami-old', after: 'ami-new' },
    ])
    expect(result.realChangeCount).toBe(1)
  })

  it('should report array object changes at indexed leaf paths', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        before: { rules: [{ cidr: '10.0.0.0/24' }, { cidr: '10.0.1.0/24' }] },
        after: { rules: [{ cidr: '10.0.0.0/24' }, { cidr: '10.0.2.0/24' }, { cidr: '10.0.3.0/24' }] },
      }),
    ])

    expect(result.resources[0].attributeDiffs).toMatchObject([
      { key: 'rules[1].cidr', kind: 'changed', before: '10.0.1.0/24', after: '10.0.2.0/24' },
      { key: 'rules[2].cidr', kind: 'added', before: undefined, after: '10.0.3.0/24' },
    ])
  })

  it('should render unknown-after-apply as a placeholder sentinel', () => {
    const diffs = diffAttributes(
      { id: null },
      { id: null },
      {
        afterUnknown: { id: true },
      },
    )

    expect(diffs).toMatchObject([{ key: 'id', kind: 'changed', before: null, after: UNKNOWN_AFTER_APPLY }])
  })

  it('should mask sensitive values in diffs', () => {
    const diffs = diffAttributes(
      { password: 'old-secret' },
      { password: 'new-secret' },
      {
        beforeSensitive: { password: true },
        afterSensitive: { password: true },
      },
    )

    expect(diffs).toMatchObject([{ key: 'password', kind: 'changed', before: SENSITIVE_VALUE, after: SENSITIVE_VALUE }])
  })

  it('should mark replacement paths on changed leaves', () => {
    const result = computeDetailedDiff([
      makeResourceChange({
        actions: ['replace'],
        before: { tags: { owner: 'platform' } },
        after: { tags: { owner: 'app' } },
        metadata: { replacePaths: [['tags']] },
      }),
    ])

    expect(result.resources[0].replacePaths).toEqual(['tags'])
    expect(result.resources[0].attributeDiffs).toMatchObject([{ key: 'tags.owner', forcesReplacement: true }])
  })
})
