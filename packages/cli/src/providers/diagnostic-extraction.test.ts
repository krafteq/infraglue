import { extractTerraformDiagnostics, extractPulumiDiagnostics } from './diagnostic-extraction'
import {
  TERRAFORM_ERROR_OUTPUT,
  TERRAFORM_ERROR_WITH_WARNINGS,
  TERRAFORM_ERROR_NO_DIAGNOSTICS,
  TERRAFORM_PLAN_WITH_DIAGNOSTICS,
  PULUMI_ERROR_STREAMING,
  PULUMI_ERROR_BLOB,
  PULUMI_ERROR_NO_DIAGNOSTICS,
  MALFORMED_NDJSON,
} from '../__test-utils__/provider-fixtures'

describe('extractTerraformDiagnostics', () => {
  it('should extract error diagnostics from stdout', () => {
    const diagnostics = extractTerraformDiagnostics(TERRAFORM_ERROR_OUTPUT, '')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].summary).toBe('error creating S3 Bucket: BucketAlreadyExists')
    expect(diagnostics[0].address).toBe('aws_s3_bucket.main')
  })

  it('should extract mixed errors and warnings', () => {
    const diagnostics = extractTerraformDiagnostics(TERRAFORM_ERROR_WITH_WARNINGS, '')
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics[0].severity).toBe('warning')
    expect(diagnostics[1].severity).toBe('error')
    expect(diagnostics[2].severity).toBe('error')
    expect(diagnostics[2].address).toBeNull()
  })

  it('should return empty array when no diagnostics present', () => {
    const diagnostics = extractTerraformDiagnostics(TERRAFORM_ERROR_NO_DIAGNOSTICS, '')
    expect(diagnostics).toHaveLength(0)
  })

  it('should return empty array for empty input', () => {
    const diagnostics = extractTerraformDiagnostics('', '')
    expect(diagnostics).toHaveLength(0)
  })

  it('should fall back to stderr when stdout is empty', () => {
    const diagnostics = extractTerraformDiagnostics('', TERRAFORM_ERROR_OUTPUT)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
  })

  it('should handle malformed lines gracefully', () => {
    const diagnostics = extractTerraformDiagnostics(MALFORMED_NDJSON, '')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].summary).toBe('real error')
  })

  it('should extract warning diagnostics from plan output', () => {
    const diagnostics = extractTerraformDiagnostics(TERRAFORM_PLAN_WITH_DIAGNOSTICS, '')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warning')
    expect(diagnostics[0].summary).toBe('Deprecated attribute')
  })
})

describe('extractPulumiDiagnostics', () => {
  it('should extract diagnostics from streaming NDJSON format', () => {
    const diagnostics = extractPulumiDiagnostics(PULUMI_ERROR_STREAMING, '')
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics[0].severity).toBe('info')
    expect(diagnostics[0].summary).toBe('Updating resources...')
    expect(diagnostics[1].severity).toBe('error')
    expect(diagnostics[1].summary).toBe('error creating S3 Bucket: BucketAlreadyExists')
    expect(diagnostics[2].severity).toBe('error')
  })

  it('should extract diagnostics from single JSON blob format', () => {
    const diagnostics = extractPulumiDiagnostics(PULUMI_ERROR_BLOB, '')
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0].severity).toBe('warning')
    expect(diagnostics[0].summary).toBe('Deprecated resource type')
    expect(diagnostics[1].severity).toBe('error')
    expect(diagnostics[1].summary).toBe('error creating S3 Bucket: BucketAlreadyExists')
  })

  it('should return empty array when no diagnostics present', () => {
    const diagnostics = extractPulumiDiagnostics(PULUMI_ERROR_NO_DIAGNOSTICS, '')
    expect(diagnostics).toHaveLength(0)
  })

  it('should return empty array for empty input', () => {
    const diagnostics = extractPulumiDiagnostics('', '')
    expect(diagnostics).toHaveLength(0)
  })

  it('should fall back to stderr when stdout is empty', () => {
    const diagnostics = extractPulumiDiagnostics('', PULUMI_ERROR_STREAMING)
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics[1].severity).toBe('error')
  })

  it('should map Pulumi info#err severity to info', () => {
    const diagnostics = extractPulumiDiagnostics(PULUMI_ERROR_STREAMING, '')
    const infoDiag = diagnostics.find((d) => d.summary === 'Updating resources...')
    expect(infoDiag?.severity).toBe('info')
  })
})
