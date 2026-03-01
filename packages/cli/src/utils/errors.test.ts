import { formatProviderErrorMessage, ProviderError } from './errors'

describe('formatProviderErrorMessage', () => {
  it('should format error diagnostics', () => {
    const diagnostics = [
      { severity: 'error', summary: 'bucket already exists', detail: '', address: 'aws_s3_bucket.main', source: null },
    ]
    const message = formatProviderErrorMessage('Terraform', 'postgres', diagnostics)
    expect(message).toContain('Terraform command failed in postgres')
    expect(message).toContain('\u2718 bucket already exists (aws_s3_bucket.main)')
    expect(message).toContain('Run with -v for full provider output')
  })

  it('should show only errors when both errors and warnings exist', () => {
    const diagnostics = [
      { severity: 'warning', summary: 'deprecated attribute', detail: '', address: null, source: null },
      { severity: 'error', summary: 'bucket already exists', detail: '', address: null, source: null },
    ]
    const message = formatProviderErrorMessage('Terraform', 'postgres', diagnostics)
    expect(message).not.toContain('deprecated attribute')
    expect(message).toContain('\u2718 bucket already exists')
  })

  it('should show warnings when no errors exist', () => {
    const diagnostics = [
      { severity: 'warning', summary: 'deprecated attribute', detail: '', address: null, source: null },
    ]
    const message = formatProviderErrorMessage('Pulumi', 'redis', diagnostics)
    expect(message).toContain('\u26A0 deprecated attribute')
  })

  it('should fall back to command when no diagnostics', () => {
    const message = formatProviderErrorMessage('Terraform', 'postgres', [], 'terraform apply --json')
    expect(message).toContain('Command: terraform apply --json')
    expect(message).toContain('Run with -v for full provider output')
  })

  it('should show just the header and hint when no diagnostics and no command', () => {
    const message = formatProviderErrorMessage('Pulumi', 'redis', [])
    expect(message).toContain('Pulumi command failed in redis')
    expect(message).toContain('Run with -v for full provider output')
    expect(message).not.toContain('Command:')
  })

  it('should format multiple errors', () => {
    const diagnostics = [
      { severity: 'error', summary: 'error one', detail: '', address: 'res.a', source: null },
      { severity: 'error', summary: 'error two', detail: '', address: null, source: null },
    ]
    const message = formatProviderErrorMessage('Terraform', 'ws', diagnostics)
    expect(message).toContain('\u2718 error one (res.a)')
    expect(message).toContain('\u2718 error two')
  })
})

describe('ProviderError', () => {
  it('should be backward compatible with no options', () => {
    const error = new ProviderError('test message', 'terraform', 'my-workspace')
    expect(error.message).toBe('test message')
    expect(error.provider).toBe('terraform')
    expect(error.workspace).toBe('my-workspace')
    expect(error.diagnostics).toEqual([])
    expect(error.command).toBeUndefined()
    expect(error.exitCode).toBe(3)
    expect(error.name).toBe('ProviderError')
  })

  it('should accept diagnostics and command options', () => {
    const diagnostics = [{ severity: 'error', summary: 'fail', detail: '', address: null, source: null }]
    const error = new ProviderError('msg', 'pulumi', 'ws', {
      diagnostics,
      command: 'pulumi up --yes',
    })
    expect(error.diagnostics).toHaveLength(1)
    expect(error.diagnostics[0].summary).toBe('fail')
    expect(error.command).toBe('pulumi up --yes')
  })
})
