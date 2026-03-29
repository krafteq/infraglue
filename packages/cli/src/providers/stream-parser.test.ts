import { describe, it, expect } from 'vitest'
import { parseTerraformStreamLine, parsePulumiStreamLine } from './stream-parser.js'
import {
  TERRAFORM_APPLY_START,
  TERRAFORM_APPLY_PROGRESS,
  TERRAFORM_APPLY_COMPLETE,
  TERRAFORM_APPLY_ERRORED,
  TERRAFORM_STREAM_DIAGNOSTIC,
  TERRAFORM_STREAM_SUMMARY,
  PULUMI_RESOURCE_PRE,
  PULUMI_RES_OUTPUTS,
  PULUMI_RES_OP_FAILED,
  PULUMI_STREAM_DIAGNOSTIC,
  PULUMI_STREAM_SUMMARY,
} from '../__test-utils__/provider-fixtures.js'

describe('parseTerraformStreamLine', () => {
  it('parses apply_start event', () => {
    const event = parseTerraformStreamLine(TERRAFORM_APPLY_START)
    expect(event).toEqual({
      type: 'resource_start',
      address: 'docker_network.main',
      resourceType: 'docker_network',
      action: 'create',
    })
  })

  it('parses apply_progress event', () => {
    const event = parseTerraformStreamLine(TERRAFORM_APPLY_PROGRESS)
    expect(event).toEqual({
      type: 'resource_progress',
      address: 'docker_network.main',
      elapsedSeconds: 10,
    })
  })

  it('parses apply_complete event', () => {
    const event = parseTerraformStreamLine(TERRAFORM_APPLY_COMPLETE)
    expect(event).toEqual({
      type: 'resource_complete',
      address: 'docker_network.main',
      action: 'create',
      elapsedSeconds: 12,
    })
  })

  it('parses apply_errored event', () => {
    const event = parseTerraformStreamLine(TERRAFORM_APPLY_ERRORED)
    expect(event).toEqual({
      type: 'resource_error',
      address: 'docker_container.app',
      message: 'error creating container: image not found',
    })
  })

  it('parses diagnostic event', () => {
    const event = parseTerraformStreamLine(TERRAFORM_STREAM_DIAGNOSTIC)
    expect(event).toEqual({
      type: 'diagnostic',
      severity: 'warning',
      summary: 'Deprecated attribute',
      detail: 'The attribute "foo" is deprecated.',
      address: 'docker_network.main',
    })
  })

  it('parses change_summary event', () => {
    const event = parseTerraformStreamLine(TERRAFORM_STREAM_SUMMARY)
    expect(event).toEqual({
      type: 'summary',
      add: 2,
      change: 0,
      remove: 0,
    })
  })

  it('returns null for unrecognized type', () => {
    const event = parseTerraformStreamLine('{"type":"version","terraform_version":"1.9.0"}')
    expect(event).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    const event = parseTerraformStreamLine('not json at all')
    expect(event).toBeNull()
  })

  it('returns null for empty line', () => {
    const event = parseTerraformStreamLine('')
    expect(event).toBeNull()
  })

  it('returns null for JSON null literal', () => {
    const event = parseTerraformStreamLine('null')
    expect(event).toBeNull()
  })
})

describe('parsePulumiStreamLine', () => {
  it('parses resourcePreEvent', () => {
    const event = parsePulumiStreamLine(PULUMI_RESOURCE_PRE)
    expect(event).toEqual({
      type: 'resource_start',
      address: 'urn:pulumi:dev::network::docker:index/network:Network::dev-network',
      resourceType: 'docker:index/network:Network',
      action: 'create',
    })
  })

  it('parses resOutputsEvent', () => {
    const event = parsePulumiStreamLine(PULUMI_RES_OUTPUTS)
    expect(event).toEqual({
      type: 'resource_complete',
      address: 'urn:pulumi:dev::network::docker:index/network:Network::dev-network',
      action: 'create',
      elapsedSeconds: 12,
    })
  })

  it('parses resOpFailedEvent', () => {
    const event = parsePulumiStreamLine(PULUMI_RES_OP_FAILED)
    expect(event).toEqual({
      type: 'resource_error',
      address: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
      message: 'error creating container: image not found',
    })
  })

  it('parses diagnosticEvent', () => {
    const event = parsePulumiStreamLine(PULUMI_STREAM_DIAGNOSTIC)
    expect(event).toEqual({
      type: 'diagnostic',
      severity: 'warning',
      summary: 'Deprecated resource type',
      detail: '',
      address: 'urn:pulumi:dev::network::docker:index/network:Network::dev-network',
    })
  })

  it('parses summaryEvent', () => {
    const event = parsePulumiStreamLine(PULUMI_STREAM_SUMMARY)
    expect(event).toEqual({
      type: 'summary',
      add: 2,
      change: 1,
      remove: 0,
    })
  })

  it('returns null for unrecognized event', () => {
    const event = parsePulumiStreamLine('{"sequence":1,"timestamp":"2024-01-15T10:00:00Z","cancelEvent":{}}')
    expect(event).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    const event = parsePulumiStreamLine('not json')
    expect(event).toBeNull()
  })

  it('returns null for JSON null literal', () => {
    const event = parsePulumiStreamLine('null')
    expect(event).toBeNull()
  })
})
