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

    it('should show changed property names under update resources', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 0, change: 1, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [
          createResourceChange({
            actions: ['update'],
            before: { ami: 'ami-old', tags: { env: 'dev' }, name: 'web' },
            after: { ami: 'ami-new', tags: { env: 'prod' }, name: 'web' },
          }),
        ],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).toContain('~ ami')
      expect(output).toContain('~ tags')
      expect(output).not.toContain('~ name')
    })

    it('should show added and removed properties under update resources', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 0, change: 1, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [
          createResourceChange({
            actions: ['update'],
            before: { old_field: 'val' },
            after: { new_field: 'val' },
          }),
        ],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).toContain('- old_field')
      expect(output).toContain('+ new_field')
    })

    it('should show property diffs for replace resources', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 0, change: 0, remove: 0, replace: 1, outputUpdates: 0 },
        resourceChanges: [
          createResourceChange({
            actions: ['replace'],
            before: { ami: 'ami-old' },
            after: { ami: 'ami-new' },
          }),
        ],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).toContain('~ ami')
    })

    it('should not show property diffs for create resources', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 1, change: 0, remove: 0, replace: 0, outputUpdates: 0 },
        resourceChanges: [
          createResourceChange({
            actions: ['create'],
            before: null,
            after: { ami: 'ami-new', tags: {} },
          }),
        ],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).not.toContain('~ ami')
      expect(output).not.toContain('+ ami')
    })

    it('should not show property diffs for delete resources', () => {
      const plan = createProviderPlan({
        changeSummary: { add: 0, change: 0, remove: 1, replace: 0, outputUpdates: 0 },
        resourceChanges: [
          createResourceChange({
            actions: ['delete'],
            before: { ami: 'ami-old' },
            after: null,
          }),
        ],
      })

      const output = DefaultFormatter.format(plan)

      expect(output).not.toContain('~ ami')
      expect(output).not.toContain('- ami')
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
