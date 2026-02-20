import { parseTerraformPlanOutput, enrichPlanWithShowOutput } from './terraform-provider.js'
import { hasChanges } from './provider-plan.js'
import {
  TERRAFORM_PLAN_CREATE,
  TERRAFORM_PLAN_UPDATE,
  TERRAFORM_PLAN_NO_CHANGES,
  TERRAFORM_PLAN_WITH_OUTPUTS,
  TERRAFORM_PLAN_WITH_DIAGNOSTICS,
  TERRAFORM_DRIFT_DETECTED,
  TERRAFORM_DRIFT_NONE,
  TERRAFORM_PLAN_MIXED_CHANGES,
  TERRAFORM_SHOW_JSON_MIXED,
} from '../__test-utils__/provider-fixtures.js'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { terraformProvider } from './terraform-provider.js'

describe('parseTerraformPlanOutput', () => {
  it('should parse create plan with resource changes', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_CREATE, 'my-project')

    expect(plan.provider).toBe('terraform')
    expect(plan.projectName).toBe('my-project')
    expect(plan.resourceChanges).toHaveLength(2)

    expect(plan.resourceChanges[0]).toMatchObject({
      address: 'docker_network.main',
      type: 'docker_network',
      name: 'main',
      actions: ['create'],
      status: 'pending',
    })

    expect(plan.resourceChanges[1]).toMatchObject({
      address: 'docker_container.app',
      type: 'docker_container',
      name: 'app',
      actions: ['create'],
    })
  })

  it('should parse change_summary counts', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_CREATE, 'proj')
    expect(plan.changeSummary).toMatchObject({ add: 2, change: 0, remove: 0, replace: 0 })
  })

  it('should parse update plan', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_UPDATE, 'proj')
    expect(plan.resourceChanges).toHaveLength(1)
    expect(plan.resourceChanges[0].actions).toEqual(['update'])
    expect(plan.resourceChanges[0].before).toEqual({ image: 'node:18' })
    expect(plan.resourceChanges[0].after).toEqual({ image: 'node:20' })
    expect(plan.changeSummary).toMatchObject({ add: 0, change: 1, remove: 0 })
  })

  it('should parse no-changes plan', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_NO_CHANGES, 'proj')
    expect(plan.resourceChanges).toHaveLength(0)
    expect(plan.changeSummary).toMatchObject({ add: 0, change: 0, remove: 0, replace: 0 })
  })

  it('should parse outputs with action mapping', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_WITH_OUTPUTS, 'proj')
    expect(plan.outputs).toHaveLength(2)

    const networkName = plan.outputs.find((o) => o.name === 'network_name')
    expect(networkName).toMatchObject({
      value: 'dev-network',
      sensitive: false,
      action: 'added',
    })

    const networkId = plan.outputs.find((o) => o.name === 'network_id')
    expect(networkId).toMatchObject({
      value: 'TO_BE_DEFINED',
      action: 'added',
    })
  })

  it('should count outputUpdates from outputs', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_WITH_OUTPUTS, 'proj')
    expect(plan.changeSummary.outputUpdates).toBe(2)
  })

  it('should parse diagnostics', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_WITH_DIAGNOSTICS, 'proj')
    expect(plan.diagnostics).toHaveLength(1)
    expect(plan.diagnostics[0]).toMatchObject({
      severity: 'warning',
      summary: 'Deprecated attribute',
      detail: 'The attribute "foo" is deprecated.',
      address: 'docker_network.main',
      source: null,
    })
  })

  it('should set timestamp', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_NO_CHANGES, 'proj')
    expect(plan.timestamp).toBeInstanceOf(Date)
  })

  it('should normalize missing before/after to null', () => {
    const output = [
      '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"aws_instance.web","resource_type":"aws_instance","resource_name":"web","provider":"registry.terraform.io/hashicorp/aws"},"action":"create","after":{"ami":"ami-123"}}}',
      '{"@level":"info","type":"change_summary","changes":{"add":1,"change":0,"remove":0}}',
    ].join('\n')

    const plan = parseTerraformPlanOutput(output, 'proj')
    expect(plan.resourceChanges[0].before).toBeNull()
    expect(plan.resourceChanges[0].after).toEqual({ ami: 'ami-123' })
  })

  it('should store raw output in metadata', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_NO_CHANGES, 'proj')
    expect(plan.metadata.rawOutput).toBe(TERRAFORM_PLAN_NO_CHANGES)
  })

  it('should handle output-only changes (no resource changes)', () => {
    const output = [
      '{"@level":"info","type":"outputs","outputs":{"url":{"value":"http://localhost","action":"update","sensitive":false}}}',
      '{"@level":"info","type":"change_summary","changes":{"add":0,"change":0,"remove":0}}',
    ].join('\n')

    const plan = parseTerraformPlanOutput(output, 'proj')
    expect(plan.resourceChanges).toHaveLength(0)
    expect(plan.outputs).toHaveLength(1)
    expect(plan.outputs[0].action).toBe('updated')
    expect(plan.changeSummary.outputUpdates).toBe(1)
  })

  it('should handle delete action in outputs', () => {
    const output = [
      '{"@level":"info","type":"outputs","outputs":{"old_key":{"action":"delete","sensitive":false}}}',
      '{"@level":"info","type":"change_summary","changes":{"add":0,"change":0,"remove":0}}',
    ].join('\n')

    const plan = parseTerraformPlanOutput(output, 'proj')
    expect(plan.outputs[0].action).toBe('deleted')
  })

  it('should handle outputs with no action', () => {
    const output = [
      '{"@level":"info","type":"outputs","outputs":{"stable":{"value":"unchanged","sensitive":false}}}',
      '{"@level":"info","type":"change_summary","changes":{"add":0,"change":0,"remove":0}}',
    ].join('\n')

    const plan = parseTerraformPlanOutput(output, 'proj')
    expect(plan.outputs[0].action).toBeUndefined()
    expect(plan.changeSummary.outputUpdates).toBe(0)
  })
})

describe('parseTerraformPlanOutput — drift detection', () => {
  it('should parse drift-detected output with resource changes', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_DRIFT_DETECTED, 'my-project')

    expect(hasChanges(plan)).toBe(true)
    expect(plan.changeSummary.change).toBe(1)
    expect(plan.resourceChanges).toHaveLength(1)
    expect(plan.resourceChanges[0]).toMatchObject({
      address: 'docker_container.app',
      actions: ['update'],
      before: { image: 'node:18', name: 'app' },
      after: { image: 'node:20', name: 'app' },
    })
  })

  it('should parse no-drift output as no changes', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_DRIFT_NONE, 'my-project')

    expect(hasChanges(plan)).toBe(false)
    expect(plan.resourceChanges).toHaveLength(0)
    expect(plan.changeSummary).toMatchObject({ add: 0, change: 0, remove: 0, replace: 0 })
  })
})

describe('TerraformProvider.existsInFolder', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tf-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it('should detect .tf files in folder', async () => {
    await writeFile(join(tmpDir, 'main.tf'), 'resource "null" "a" {}')
    expect(await terraformProvider.existsInFolder(tmpDir)).toBe(true)
  })

  it('should return false for empty folder', async () => {
    expect(await terraformProvider.existsInFolder(tmpDir)).toBe(false)
  })

  it('should return false for folder with non-tf files', async () => {
    await writeFile(join(tmpDir, 'Pulumi.yaml'), 'name: test')
    expect(await terraformProvider.existsInFolder(tmpDir)).toBe(false)
  })

  it('should return false for non-existent folder', async () => {
    expect(await terraformProvider.existsInFolder('/tmp/non-existent-folder-xyz')).toBe(false)
  })
})

describe('enrichPlanWithShowOutput', () => {
  it('should merge before/after from show output into plan resource changes', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_MIXED_CHANGES, 'proj')
    // Streaming format may not have real before/after — enrichment provides them
    const enriched = enrichPlanWithShowOutput(plan, TERRAFORM_SHOW_JSON_MIXED)

    const app = enriched.resourceChanges.find((rc) => rc.address === 'docker_container.app')!
    expect(app.before).toEqual({ image: 'node:18', name: 'app', ports: [{ internal: 3000, external: 3000 }] })
    expect(app.after).toEqual({ image: 'node:20', name: 'app', ports: [{ internal: 3000, external: 3000 }] })

    const network = enriched.resourceChanges.find((rc) => rc.address === 'docker_network.main')!
    expect(network.before).toEqual({ name: 'dev-network', driver: 'bridge' })
    expect(network.after).toEqual({ name: 'dev-network', driver: 'bridge' })

    const volume = enriched.resourceChanges.find((rc) => rc.address === 'docker_volume.data')!
    expect(volume.before).toBeNull()
    expect(volume.after).toEqual({ name: 'app-data' })
  })

  it('should preserve plan metadata (summary, outputs, diagnostics)', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_MIXED_CHANGES, 'proj')
    const enriched = enrichPlanWithShowOutput(plan, TERRAFORM_SHOW_JSON_MIXED)

    expect(enriched.changeSummary).toEqual(plan.changeSummary)
    expect(enriched.provider).toBe('terraform')
    expect(enriched.projectName).toBe('proj')
  })

  it('should handle empty resource_changes in show output', () => {
    const plan = parseTerraformPlanOutput(TERRAFORM_PLAN_UPDATE, 'proj')
    const enriched = enrichPlanWithShowOutput(plan, JSON.stringify({ resource_changes: [] }))

    // No match found — original before/after preserved
    expect(enriched.resourceChanges[0].before).toEqual(plan.resourceChanges[0].before)
  })
})
