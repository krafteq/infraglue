import type { ChangeAction, ResourceChange } from '../providers/provider-plan.js'

export type AttributeDiffKind = 'added' | 'removed' | 'changed'

export const UNKNOWN_AFTER_APPLY = Symbol('UNKNOWN_AFTER_APPLY')
export const SENSITIVE_VALUE = Symbol('SENSITIVE_VALUE')

export interface AttributeDiff {
  key: string
  kind: AttributeDiffKind
  before: unknown
  after: unknown
  beforeSensitive: boolean
  afterSensitive: boolean
  afterUnknown: boolean
  forcesReplacement: boolean
}

export interface ResourceDiffResult {
  address: string
  actions: ChangeAction[]
  attributeDiffs: AttributeDiff[]
  replacePaths: string[]
  isMetadataOnly: boolean
}

export interface DetailedPlanResult {
  resources: ResourceDiffResult[]
  metadataOnlyCount: number
  realChangeCount: number
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((val, i) => deepEqual(val, b[i]))
  }

  if (typeof a === 'object') {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj)
    const bKeys = Object.keys(bObj)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqual(aObj[key], bObj[key]))
  }

  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${JSON.stringify(key)}]`
}

function appendObjectPath(base: string, key: string): string {
  const normalized = normalizeKey(key)
  if (!base) return normalized
  if (normalized.startsWith('[')) return `${base}${normalized}`
  return `${base}.${normalized}`
}

function appendArrayPath(base: string, index: number): string {
  return `${base}[${index}]`
}

function metadataObject(change: ResourceChange, key: string): unknown {
  return change.metadata[key]
}

function normalizeProviderPath(path: unknown): string | null {
  if (typeof path === 'string') return path
  if (!Array.isArray(path)) return null

  let result = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      result = appendArrayPath(result, segment)
    } else if (typeof segment === 'string') {
      result = appendObjectPath(result, segment)
    } else {
      return null
    }
  }
  return result
}

function normalizeProviderPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  return paths
    .map(normalizeProviderPath)
    .filter((path): path is string => path !== null)
    .sort()
}

function hasMaskAtPath(mask: unknown, path: string[]): boolean {
  if (mask === true) return true
  if (!isPlainObject(mask) && !Array.isArray(mask)) return false
  if (path.length === 0) return false

  const [head, ...rest] = path
  const next = Array.isArray(mask) ? mask[Number(head)] : (mask as Record<string, unknown>)[head]
  return hasMaskAtPath(next, rest)
}

function collectTruePaths(mask: unknown, basePath: string[] = []): string[][] {
  if (mask === true) return [basePath]
  if (!isPlainObject(mask) && !Array.isArray(mask)) return []

  const entries = Array.isArray(mask)
    ? mask.map((value, index) => [String(index), value] as const)
    : Object.entries(mask).sort(([a], [b]) => a.localeCompare(b))

  return entries.flatMap(([key, value]) => collectTruePaths(value, [...basePath, key]))
}

function pathArrayToString(path: string[]): string {
  let result = ''
  for (const segment of path) {
    const index = Number(segment)
    if (String(index) === segment && Number.isInteger(index) && index >= 0) {
      result = appendArrayPath(result, index)
    } else {
      result = appendObjectPath(result, segment)
    }
  }
  return result
}

function getValueAtPath(value: unknown, path: string[]): unknown {
  let current = value
  for (const segment of path) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      current = current[Number(segment)]
    } else if (isPlainObject(current)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

function createDiff(
  key: string,
  path: string[],
  before: unknown,
  after: unknown,
  options: DiffHints,
  afterUnknown = false,
): AttributeDiff {
  const beforeExists = before !== undefined
  const afterExists = after !== undefined || afterUnknown
  const beforeSensitive = hasMaskAtPath(options.beforeSensitive, path)
  const afterSensitive = hasMaskAtPath(options.afterSensitive, path)
  const renderedBefore = beforeSensitive ? SENSITIVE_VALUE : before
  const renderedAfter = afterSensitive ? SENSITIVE_VALUE : afterUnknown ? UNKNOWN_AFTER_APPLY : after

  return {
    key,
    kind: !beforeExists && afterExists ? 'added' : beforeExists && !afterExists ? 'removed' : 'changed',
    before: renderedBefore,
    after: renderedAfter,
    beforeSensitive,
    afterSensitive,
    afterUnknown,
    forcesReplacement: isReplacementPath(key, options.replacePaths),
  }
}

function isReplacementPath(key: string, replacePaths: Set<string>): boolean {
  for (const replacePath of replacePaths) {
    if (
      key === replacePath ||
      key.startsWith(`${replacePath}.`) ||
      key.startsWith(`${replacePath}[`) ||
      replacePath.startsWith(`${key}.`) ||
      replacePath.startsWith(`${key}[`)
    ) {
      return true
    }
  }
  return false
}

interface DiffHints {
  beforeSensitive: unknown
  afterSensitive: unknown
  afterUnknown: unknown
  replacePaths: Set<string>
}

function diffValue(
  before: unknown,
  after: unknown,
  path: string[],
  key: string,
  options: DiffHints,
  diffs: AttributeDiff[],
): void {
  if (deepEqual(before, after) && !hasMaskAtPath(options.afterUnknown, path)) return

  const isSensitive = hasMaskAtPath(options.beforeSensitive, path) || hasMaskAtPath(options.afterSensitive, path)
  const afterUnknown = hasMaskAtPath(options.afterUnknown, path)

  if (isSensitive || afterUnknown) {
    diffs.push(createDiff(key, path, before, after, options, afterUnknown))
    return
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const childKey of keys) {
      diffValue(before[childKey], after[childKey], [...path, childKey], appendObjectPath(key, childKey), options, diffs)
    }
    return
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length)
    for (let index = 0; index < length; index++) {
      diffValue(before[index], after[index], [...path, String(index)], appendArrayPath(key, index), options, diffs)
    }
    return
  }

  if (before === undefined && (isPlainObject(after) || Array.isArray(after))) {
    diffAddedOrRemoved(after, path, key, options, diffs, 'added')
    return
  }

  if (after === undefined && (isPlainObject(before) || Array.isArray(before))) {
    diffAddedOrRemoved(before, path, key, options, diffs, 'removed')
    return
  }

  diffs.push(createDiff(key, path, before, after, options))
}

function diffAddedOrRemoved(
  value: unknown,
  path: string[],
  key: string,
  options: DiffHints,
  diffs: AttributeDiff[],
  kind: 'added' | 'removed',
): void {
  const isSensitive = hasMaskAtPath(kind === 'added' ? options.afterSensitive : options.beforeSensitive, path)
  if (isSensitive || (!isPlainObject(value) && !Array.isArray(value))) {
    diffs.push(
      createDiff(key, path, kind === 'added' ? undefined : value, kind === 'added' ? value : undefined, options),
    )
    return
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    if (entries.length === 0) {
      diffs.push(
        createDiff(key, path, kind === 'added' ? undefined : value, kind === 'added' ? value : undefined, options),
      )
      return
    }
    for (const [childKey, childValue] of entries) {
      diffAddedOrRemoved(childValue, [...path, childKey], appendObjectPath(key, childKey), options, diffs, kind)
    }
    return
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      diffs.push(
        createDiff(key, path, kind === 'added' ? undefined : value, kind === 'added' ? value : undefined, options),
      )
      return
    }
    value.forEach((childValue, index) => {
      diffAddedOrRemoved(childValue, [...path, String(index)], appendArrayPath(key, index), options, diffs, kind)
    })
  }
}

export function resourceReplacePaths(change: ResourceChange): string[] {
  return normalizeProviderPaths(metadataObject(change, 'replacePaths'))
}

export function diffAttributes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): AttributeDiff[] {
  const diffs: AttributeDiff[] = []
  const replacePaths = new Set(normalizeProviderPaths(metadata.replacePaths))
  const options: DiffHints = {
    beforeSensitive: metadata.beforeSensitive,
    afterSensitive: metadata.afterSensitive,
    afterUnknown: metadata.afterUnknown,
    replacePaths,
  }
  const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()

  for (const key of allKeys) {
    diffValue(before[key], after[key], [key], normalizeKey(key), options, diffs)
  }

  for (const unknownPath of collectTruePaths(metadata.afterUnknown)) {
    const key = pathArrayToString(unknownPath)
    if (!key || diffs.some((diff) => diff.key === key)) continue
    diffs.push(createDiff(key, unknownPath, getValueAtPath(before, unknownPath), undefined, options, true))
  }

  diffs.sort((a, b) => a.key.localeCompare(b.key))
  return diffs
}

export function computeDetailedDiff(resourceChanges: ResourceChange[]): DetailedPlanResult {
  const resources: ResourceDiffResult[] = []
  let metadataOnlyCount = 0
  let realChangeCount = 0

  for (const rc of resourceChanges) {
    if (rc.actions.includes('update') && rc.before != null && rc.after != null) {
      const attributeDiffs = diffAttributes(rc.before, rc.after, rc.metadata)
      const isMetadataOnly = attributeDiffs.length === 0
      resources.push({
        address: rc.address,
        actions: rc.actions,
        attributeDiffs,
        replacePaths: resourceReplacePaths(rc),
        isMetadataOnly,
      })
      if (isMetadataOnly) {
        metadataOnlyCount++
      } else {
        realChangeCount++
      }
    } else {
      resources.push({
        address: rc.address,
        actions: rc.actions,
        attributeDiffs:
          rc.before != null && rc.after != null && rc.actions.includes('replace')
            ? diffAttributes(rc.before, rc.after, rc.metadata)
            : [],
        replacePaths: resourceReplacePaths(rc),
        isMetadataOnly: false,
      })
      realChangeCount++
    }
  }

  return { resources, metadataOnlyCount, realChangeCount }
}
