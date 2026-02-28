import type { Diagnostic, DiagnosticSeverity } from './provider-plan.js'

export function mapPulumiSeverity(severity: string): DiagnosticSeverity {
  if (severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
  // Pulumi uses "info#err" for info-level messages on stderr
  return 'info'
}

export function extractTerraformDiagnostics(stdout: string, stderr: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const source = stdout || stderr
  if (!source.trim()) return diagnostics

  for (const line of source.trim().split('\n')) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'diagnostic') {
        diagnostics.push({
          severity: obj.diagnostic.severity,
          summary: obj.diagnostic.summary,
          detail: obj.diagnostic.detail ?? '',
          address: obj.diagnostic.address ?? null,
          source: null,
        })
      }
    } catch {
      // skip malformed lines
    }
  }

  return diagnostics
}

export function extractPulumiDiagnostics(stdout: string, stderr: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const source = stdout || stderr
  if (!source.trim()) return diagnostics

  // Strategy 1: single JSON blob with .diagnostics array (preview format)
  try {
    const parsed = JSON.parse(source)
    if (Array.isArray(parsed.diagnostics)) {
      for (const d of parsed.diagnostics) {
        diagnostics.push({
          severity: mapPulumiSeverity(d.severity ?? 'error'),
          summary: d.message ?? d.summary ?? '',
          detail: d.detail ?? '',
          address: d.address ?? null,
          source: null,
        })
      }
      return diagnostics
    }
  } catch {
    // not a single JSON blob, try NDJSON
  }

  // Strategy 2: NDJSON with diagnosticEvent entries (streaming format)
  for (const line of source.trim().split('\n')) {
    try {
      const obj = JSON.parse(line)
      if (obj.diagnosticEvent) {
        diagnostics.push({
          severity: mapPulumiSeverity(obj.diagnosticEvent.severity ?? 'error'),
          summary: obj.diagnosticEvent.message ?? '',
          detail: '',
          address: null,
          source: null,
        })
      }
    } catch {
      // skip malformed lines
    }
  }

  return diagnostics
}
