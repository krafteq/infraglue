import { parsePulumiPreviewOutput } from './pulumi-provider.js'
import {
  PULUMI_PREVIEW_CREATE,
  PULUMI_PREVIEW_UPDATE,
  PULUMI_PREVIEW_MIXED,
  PULUMI_PREVIEW_NO_CHANGES,
  PULUMI_PREVIEW_WITH_OUTPUTS,
} from '../__test-utils__/provider-fixtures.js'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { pulumiProvider } from './pulumi-provider.js'

describe('parsePulumiPreviewOutput', () => {
  it('should parse create preview with resource changes', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_CREATE, 'network')

    expect(plan.provider).toBe('pulumi')
    expect(plan.projectName).toBe('network')
    expect(plan.resourceChanges).toHaveLength(2)

    expect(plan.resourceChanges[0]).toMatchObject({
      type: 'docker:index/network:Network',
      name: 'dev-network',
      actions: ['create'],
      status: 'pending',
    })
    expect(plan.resourceChanges[0].after).toEqual({ name: 'dev-network', driver: 'bridge' })
  })

  it('should count creates in changeSummary', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_CREATE, 'proj')
    expect(plan.changeSummary).toMatchObject({ add: 2, change: 0, remove: 0, replace: 0 })
  })

  it('should parse update preview', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_UPDATE, 'proj')
    expect(plan.resourceChanges).toHaveLength(1)
    expect(plan.resourceChanges[0].actions).toEqual(['update'])
    expect(plan.changeSummary).toMatchObject({ add: 0, change: 1, remove: 0, replace: 0 })
  })

  it('should parse mixed operations', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_MIXED, 'proj')
    expect(plan.resourceChanges).toHaveLength(5)
    expect(plan.changeSummary).toMatchObject({ add: 1, change: 1, remove: 1, replace: 1 })
  })

  it('should map same op to no-op action', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_NO_CHANGES, 'proj')
    expect(plan.resourceChanges).toHaveLength(1)
    expect(plan.resourceChanges[0].actions).toEqual(['no-op'])
    expect(plan.changeSummary).toMatchObject({ add: 0, change: 0, remove: 0, replace: 0 })
  })

  it('should parse URN for resource type and name', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_CREATE, 'proj')
    // urn:pulumi:dev::network::docker:index/network:Network::dev-network
    expect(plan.resourceChanges[0].type).toBe('docker:index/network:Network')
    expect(plan.resourceChanges[0].name).toBe('dev-network')
    expect(plan.resourceChanges[0].address).toContain('urn:pulumi:')
  })

  it('should parse delete operation', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_MIXED, 'proj')
    const deleteChange = plan.resourceChanges.find((r) => r.actions[0] === 'delete')
    expect(deleteChange).toBeDefined()
    expect(deleteChange!.name).toBe('old-bucket')
  })

  it('should parse replace operation', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_MIXED, 'proj')
    const replaceChange = plan.resourceChanges.find((r) => r.actions[0] === 'replace')
    expect(replaceChange).toBeDefined()
    expect(replaceChange!.name).toBe('database')
  })

  it('should parse string outputs', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_WITH_OUTPUTS, 'proj')
    const networkName = plan.outputs.find((o) => o.name === 'network_name')
    expect(networkName).toMatchObject({
      value: 'dev-network',
      sensitive: false,
    })
  })

  it('should JSON.stringify complex outputs', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_WITH_OUTPUTS, 'proj')
    const config = plan.outputs.find((o) => o.name === 'config')
    expect(config).toBeDefined()
    expect(JSON.parse(config!.value)).toEqual({ host: 'localhost', port: 5432 })
  })

  it('should handle preview with no steps', () => {
    const plan = parsePulumiPreviewOutput(JSON.stringify({}), 'proj')
    expect(plan.resourceChanges).toHaveLength(0)
    expect(plan.outputs).toHaveLength(0)
  })

  it('should set timestamp', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_NO_CHANGES, 'proj')
    expect(plan.timestamp).toBeInstanceOf(Date)
  })

  it('should store raw output in metadata', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_NO_CHANGES, 'proj')
    expect(plan.metadata.rawOutput).toBe(PULUMI_PREVIEW_NO_CHANGES)
  })

  it('should set before to null for create resources', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_CREATE, 'proj')
    for (const change of plan.resourceChanges) {
      expect(change.before).toBeNull()
    }
  })

  it('should read oldState for update resources', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_UPDATE, 'proj')
    expect(plan.resourceChanges[0].before).toEqual({ name: 'app', image: 'node:18' })
    expect(plan.resourceChanges[0].after).toEqual({ name: 'app', image: 'node:20' })
  })

  it('should handle delete with oldState but no newState', () => {
    const plan = parsePulumiPreviewOutput(PULUMI_PREVIEW_MIXED, 'proj')
    const deleteChange = plan.resourceChanges.find((r) => r.actions[0] === 'delete')
    expect(deleteChange!.before).toEqual({ bucketName: 'my-old-bucket' })
    expect(deleteChange!.after).toBeNull()
  })
})

describe('PulumiProvider.existsInFolder', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pulumi-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it('should detect Pulumi.yaml in folder', async () => {
    await writeFile(join(tmpDir, 'Pulumi.yaml'), 'name: test\nruntime: nodejs')
    expect(await pulumiProvider.existsInFolder(tmpDir)).toBe(true)
  })

  it('should return false for empty folder', async () => {
    expect(await pulumiProvider.existsInFolder(tmpDir)).toBe(false)
  })

  it('should return false for folder with .tf files only', async () => {
    await writeFile(join(tmpDir, 'main.tf'), 'resource "null" "a" {}')
    expect(await pulumiProvider.existsInFolder(tmpDir)).toBe(false)
  })
})
