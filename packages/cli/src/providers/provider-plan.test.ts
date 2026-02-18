import { hasChanges } from './provider-plan.js'
import { createProviderPlan } from '../__test-utils__/mock-provider.js'

describe('hasChanges', () => {
  it('should return false for zero changes', () => {
    expect(hasChanges(createProviderPlan())).toBe(false)
  })

  it('should return true when add > 0', () => {
    expect(
      hasChanges(createProviderPlan({ changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 } })),
    ).toBe(true)
  })

  it('should return true when change > 0', () => {
    expect(
      hasChanges(createProviderPlan({ changeSummary: { add: 0, change: 1, remove: 0, replace: 0, outputUpdates: 0 } })),
    ).toBe(true)
  })

  it('should return true when remove > 0', () => {
    expect(
      hasChanges(createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 } })),
    ).toBe(true)
  })

  it('should return true when replace > 0', () => {
    expect(
      hasChanges(createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 0, replace: 1, outputUpdates: 0 } })),
    ).toBe(true)
  })

  it('should return true when outputUpdates > 0', () => {
    expect(
      hasChanges(createProviderPlan({ changeSummary: { add: 0, change: 0, remove: 0, replace: 0, outputUpdates: 1 } })),
    ).toBe(true)
  })

  it('should return true with multiple change types', () => {
    expect(
      hasChanges(createProviderPlan({ changeSummary: { add: 2, change: 1, remove: 3, replace: 0, outputUpdates: 1 } })),
    ).toBe(true)
  })
})
