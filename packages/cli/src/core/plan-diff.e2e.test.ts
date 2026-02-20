import { computeDetailedDiff } from './plan-diff.js'
import { parseTerraformPlanOutput } from '../providers/terraform-provider.js'
import { parsePulumiPreviewOutput } from '../providers/pulumi-provider.js'
import {
  TERRAFORM_PLAN_CREATE,
  TERRAFORM_PLAN_UPDATE,
  TERRAFORM_PLAN_METADATA_ONLY,
  TERRAFORM_PLAN_MIXED_CHANGES,
  TERRAFORM_PLAN_NO_CHANGES,
  PULUMI_PREVIEW_CREATE,
  PULUMI_PREVIEW_UPDATE,
  PULUMI_PREVIEW_METADATA_ONLY,
  PULUMI_PREVIEW_MIXED,
  PULUMI_PREVIEW_NO_CHANGES,
} from '../__test-utils__/provider-fixtures.js'

describe('computeDetailedDiff with real Terraform output', () => {
  it('should detect real attribute diff from Terraform update plan', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_UPDATE, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(1)
    expect(diff.resources[0].isMetadataOnly).toBe(false)
    expect(diff.resources[0].attributeDiffs).toEqual([{ key: 'image', before: 'node:18', after: 'node:20' }])
    expect(diff.realChangeCount).toBe(1)
    expect(diff.metadataOnlyCount).toBe(0)
  })

  it('should detect metadata-only when Terraform before/after are identical', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_METADATA_ONLY, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(1)
    expect(diff.resources[0].isMetadataOnly).toBe(true)
    expect(diff.resources[0].attributeDiffs).toEqual([])
    expect(diff.metadataOnlyCount).toBe(1)
    expect(diff.realChangeCount).toBe(0)
  })

  it('should handle Terraform create (before null) as real change', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_CREATE, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(2)
    for (const resource of diff.resources) {
      expect(resource.isMetadataOnly).toBe(false)
    }
    expect(diff.realChangeCount).toBe(2)
    expect(diff.metadataOnlyCount).toBe(0)
  })

  it('should return empty result for Terraform no-changes plan', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_NO_CHANGES, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toEqual([])
    expect(diff.realChangeCount).toBe(0)
    expect(diff.metadataOnlyCount).toBe(0)
  })

  it('should separate real changes from metadata-only in mixed Terraform plan', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_MIXED_CHANGES, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(3)

    // docker_container.app — real update (image changed)
    const app = diff.resources.find((r) => r.address === 'docker_container.app')!
    expect(app.isMetadataOnly).toBe(false)
    expect(app.attributeDiffs).toEqual([{ key: 'image', before: 'node:18', after: 'node:20' }])

    // docker_network.main — metadata-only (identical before/after)
    const network = diff.resources.find((r) => r.address === 'docker_network.main')!
    expect(network.isMetadataOnly).toBe(true)
    expect(network.attributeDiffs).toEqual([])

    // docker_volume.data — create (before null)
    const volume = diff.resources.find((r) => r.address === 'docker_volume.data')!
    expect(volume.isMetadataOnly).toBe(false)
    expect(volume.actions).toEqual(['create'])

    expect(diff.realChangeCount).toBe(2)
    expect(diff.metadataOnlyCount).toBe(1)
  })
})

describe('computeDetailedDiff with real Pulumi output', () => {
  it('should handle Pulumi create (no oldState) as real change', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_CREATE, 'network')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(2)
    for (const resource of diff.resources) {
      expect(resource.isMetadataOnly).toBe(false)
    }
    expect(diff.realChangeCount).toBe(2)
    expect(diff.metadataOnlyCount).toBe(0)
  })

  it('should detect real attribute diff from Pulumi update', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_UPDATE, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(1)
    expect(diff.resources[0].isMetadataOnly).toBe(false)
    expect(diff.resources[0].attributeDiffs).toEqual([{ key: 'image', before: 'node:18', after: 'node:20' }])
    expect(diff.realChangeCount).toBe(1)
    expect(diff.metadataOnlyCount).toBe(0)
  })

  it('should detect metadata-only when Pulumi oldState/newState inputs are identical', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_METADATA_ONLY, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(1)
    expect(diff.resources[0].isMetadataOnly).toBe(true)
    expect(diff.resources[0].attributeDiffs).toEqual([])
    expect(diff.metadataOnlyCount).toBe(1)
    expect(diff.realChangeCount).toBe(0)
  })

  it('should handle mixed Pulumi operations with real diffs', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_MIXED, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    // 5 resources: create, update, delete, replace, same
    expect(diff.resources).toHaveLength(5)

    // update has real diff (instanceType changed)
    const update = diff.resources.find((r) => r.actions.includes('update'))!
    expect(update.isMetadataOnly).toBe(false)
    expect(update.attributeDiffs).toEqual([{ key: 'instanceType', before: 't2.micro', after: 't3.medium' }])

    // same/no-op is not an 'update' action, so it's not diffed for metadata-only
    const noop = diff.resources.find((r) => r.actions.includes('no-op'))!
    expect(noop.isMetadataOnly).toBe(false)
  })

  it('should handle Pulumi no-changes (only same/no-op steps)', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_NO_CHANGES, 'proj')
    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources).toHaveLength(1)
    expect(diff.resources[0].actions).toEqual(['no-op'])
  })
})
