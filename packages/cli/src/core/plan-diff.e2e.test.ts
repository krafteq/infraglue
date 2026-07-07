import { computeDetailedDiff } from './plan-diff.js'
import { SENSITIVE_VALUE, UNKNOWN_AFTER_APPLY } from './plan-diff.js'
import { parseTerraformPlanOutput, enrichPlanWithShowOutput } from '../providers/terraform-provider.js'
import { parsePulumiPreviewOutput } from '../providers/pulumi-provider.js'
import {
  TERRAFORM_PLAN_CREATE,
  TERRAFORM_PLAN_UPDATE,
  TERRAFORM_PLAN_METADATA_ONLY,
  TERRAFORM_PLAN_MIXED_CHANGES,
  TERRAFORM_PLAN_NO_CHANGES,
  TERRAFORM_SHOW_JSON_MIXED,
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
    expect(diff.resources[0].attributeDiffs).toMatchObject([
      { key: 'image', kind: 'changed', before: 'node:18', after: 'node:20' },
    ])
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
    expect(app.attributeDiffs).toMatchObject([{ key: 'image', before: 'node:18', after: 'node:20' }])

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

describe('computeDetailedDiff with enriched Terraform output (streaming + show)', () => {
  it('should classify metadata-only vs real changes after enrichment', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_MIXED_CHANGES, 'proj')
    const enriched = enrichPlanWithShowOutput(plan, TERRAFORM_SHOW_JSON_MIXED)
    const diff = computeDetailedDiff(enriched.resourceChanges)

    expect(diff.resources).toHaveLength(3)

    // docker_container.app — real update (image changed from node:18 to node:20)
    const app = diff.resources.find((r) => r.address === 'docker_container.app')!
    expect(app.isMetadataOnly).toBe(false)
    expect(app.attributeDiffs).toMatchObject([{ key: 'image', before: 'node:18', after: 'node:20' }])

    // docker_network.main — metadata-only (identical before/after from show output)
    const network = diff.resources.find((r) => r.address === 'docker_network.main')!
    expect(network.isMetadataOnly).toBe(true)

    // docker_volume.data — create (before null)
    const volume = diff.resources.find((r) => r.address === 'docker_volume.data')!
    expect(volume.isMetadataOnly).toBe(false)
    expect(volume.actions).toEqual(['create'])

    expect(diff.realChangeCount).toBe(2)
    expect(diff.metadataOnlyCount).toBe(1)
  })

  it('should report nested object and array leaf paths from Terraform show output', () => {
    const plan = parseTerraformPlanOutput(
      [
        '{"type":"planned_change","change":{"resource":{"addr":"aws_security_group.web","resource_type":"aws_security_group","resource_name":"web"},"action":"update","before":{},"after":{}}}',
        '{"type":"change_summary","changes":{"add":0,"change":1,"remove":0,"replace":0}}',
      ].join('\n'),
      'proj',
    )
    const enriched = enrichPlanWithShowOutput(
      plan,
      JSON.stringify({
        resource_changes: [
          {
            address: 'aws_security_group.web',
            change: {
              actions: ['update'],
              before: {
                tags: { owner: 'platform', env: 'dev' },
                rules: [{ cidr: '10.0.0.0/24' }, { cidr: '10.0.1.0/24' }],
              },
              after: {
                tags: { owner: 'app', env: 'dev' },
                rules: [{ cidr: '10.0.0.0/24' }, { cidr: '10.0.2.0/24' }, { cidr: '10.0.3.0/24' }],
              },
            },
          },
        ],
      }),
    )

    const diff = computeDetailedDiff(enriched.resourceChanges)

    expect(diff.resources[0].attributeDiffs).toMatchObject([
      { key: 'rules[1].cidr', kind: 'changed', before: '10.0.1.0/24', after: '10.0.2.0/24' },
      { key: 'rules[2].cidr', kind: 'added', before: undefined, after: '10.0.3.0/24' },
      { key: 'tags.owner', kind: 'changed', before: 'platform', after: 'app' },
    ])
  })

  it('should surface Terraform replacement, unknown, and sensitive metadata', () => {
    const plan = parseTerraformPlanOutput(
      [
        '{"type":"planned_change","change":{"resource":{"addr":"aws_instance.web","resource_type":"aws_instance","resource_name":"web"},"action":"update","before":{},"after":{}}}',
        '{"type":"change_summary","changes":{"add":0,"change":0,"remove":0,"replace":1}}',
      ].join('\n'),
      'proj',
    )
    const enriched = enrichPlanWithShowOutput(
      plan,
      JSON.stringify({
        resource_changes: [
          {
            address: 'aws_instance.web',
            change: {
              actions: ['delete', 'create'],
              before: { ami: 'ami-old', id: 'i-123', password: 'old-secret' },
              after: { ami: 'ami-new', id: null, password: 'new-secret' },
              after_unknown: { id: true },
              before_sensitive: { password: true },
              after_sensitive: { password: true },
              replace_paths: [['ami']],
            },
          },
        ],
      }),
    )

    const diff = computeDetailedDiff(enriched.resourceChanges)

    expect(diff.resources[0].actions).toEqual(['replace'])
    expect(diff.resources[0].replacePaths).toEqual(['ami'])
    expect(diff.resources[0].attributeDiffs).toMatchObject([
      { key: 'ami', forcesReplacement: true },
      { key: 'id', after: UNKNOWN_AFTER_APPLY },
      { key: 'password', before: SENSITIVE_VALUE, after: SENSITIVE_VALUE },
    ])
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
    expect(diff.resources[0].attributeDiffs).toMatchObject([{ key: 'image', before: 'node:18', after: 'node:20' }])
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
    expect(update.attributeDiffs).toMatchObject([{ key: 'instanceType', before: 't2.micro', after: 't3.medium' }])

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

  it('should report nested Pulumi detailed diff leaf paths', () => {
    const plan = parsePulumiPreviewOutput(
      JSON.stringify({
        steps: [
          {
            op: 'update',
            urn: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
            oldState: { inputs: { tags: { owner: 'platform' }, ports: [{ internal: 80, external: 8080 }] } },
            newState: { inputs: { tags: { owner: 'app' }, ports: [{ internal: 80, external: 8081 }] } },
            detailedDiff: {
              'tags.owner': { kind: 'UPDATE' },
              'ports[0].external': { kind: 'UPDATE' },
            },
          },
        ],
      }),
      'proj',
    )

    const diff = computeDetailedDiff(plan.resourceChanges)

    expect(diff.resources[0].attributeDiffs).toMatchObject([
      { key: 'ports[0].external', before: 8080, after: 8081 },
      { key: 'tags.owner', before: 'platform', after: 'app' },
    ])
  })
})
