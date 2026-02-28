import { DefaultFormatter } from './default-formatter.js'
import { createProviderPlan } from '../__test-utils__/mock-provider.js'
import type { ResourceChange } from '../providers/provider-plan.js'

function createResourceChange(overrides: Partial<ResourceChange> = {}): ResourceChange {
  return {
    address: 'aws_instance.web',
    type: 'aws_instance',
    name: 'web',
    actions: ['create'],
    status: 'pending',
    before: null,
    after: null,
    metadata: {},
    ...overrides,
  }
}

describe('DefaultFormatter', () => {
  describe('format()', () => {
    it('should not contain HTML details/summary tags', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [createResourceChange()],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).not.toContain('<details>')
      expect(output).not.toContain('<summary>')
      expect(output).not.toContain('</details>')
    })

    it('should not contain markdown diff fences', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [createResourceChange()],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).not.toContain('```diff')
      expect(output).not.toContain('```')
    })

    it('should render table with op/type/name/plan columns', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [createResourceChange()],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).toContain('Type')
      expect(output).toContain('Name')
      expect(output).toContain('Plan')
      expect(output).toContain('aws_instance')
      expect(output).toContain('web')
      expect(output).toContain('create')
    })

    it('should contain colorized summary text', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 2, change: 0, remove: 1, replace: 0, outputUpdates: 0 },
        resourceChanges: [
          createResourceChange(),
          createResourceChange({ name: 'api', address: 'aws_instance.api' }),
          createResourceChange({ actions: ['delete'], name: 'old', address: 'aws_instance.old' }),
        ],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).toContain('+2 create')
      expect(output).toContain('-1 delete')
    })

    it('should return empty string when no changes', () => {
      const plan = createProviderPlan()

      const output = DefaultFormatter.format(plan)

      expect(output).toBe('')
    })
  })

  describe('formatForMarkdown()', () => {
    it('should contain HTML details/summary tags', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [createResourceChange()],
      })

      const output = DefaultFormatter.formatForMarkdown(plan)

      expect(output).toContain('<details>')
      expect(output).toContain('<summary>')
      expect(output).toContain('</details>')
    })

    it('should contain markdown diff fences', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [createResourceChange()],
      })

      const output = DefaultFormatter.formatForMarkdown(plan)

      expect(output).toContain('```diff')
    })
  })
})
