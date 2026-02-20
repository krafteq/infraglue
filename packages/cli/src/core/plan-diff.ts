import type { ChangeAction, ResourceChange } from '../providers/provider-plan.js'

export interface AttributeDiff {
  key: string
  before: unknown
  after: unknown
}

export interface ResourceDiffResult {
  address: string
  actions: ChangeAction[]
  attributeDiffs: AttributeDiff[]
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

function diffAttributes(before: Record<string, unknown>, after: Record<string, unknown>): AttributeDiff[] {
  const diffs: AttributeDiff[] = []
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

  for (const key of allKeys) {
    const beforeVal = before[key]
    const afterVal = after[key]
    if (!deepEqual(beforeVal, afterVal)) {
      diffs.push({ key, before: beforeVal, after: afterVal })
    }
  }

  return diffs
}

export function computeDetailedDiff(resourceChanges: ResourceChange[]): DetailedPlanResult {
  const resources: ResourceDiffResult[] = []
  let metadataOnlyCount = 0
  let realChangeCount = 0

  for (const rc of resourceChanges) {
    if (rc.actions.includes('update') && rc.before != null && rc.after != null) {
      const attributeDiffs = diffAttributes(rc.before, rc.after)
      const isMetadataOnly = attributeDiffs.length === 0
      resources.push({ address: rc.address, actions: rc.actions, attributeDiffs, isMetadataOnly })
      if (isMetadataOnly) {
        metadataOnlyCount++
      } else {
        realChangeCount++
      }
    } else {
      resources.push({
        address: rc.address,
        actions: rc.actions,
        attributeDiffs: [],
        isMetadataOnly: false,
      })
      realChangeCount++
    }
  }

  return { resources, metadataOnlyCount, realChangeCount }
}
