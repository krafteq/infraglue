import type { ProviderPlan, ResourceChange, Diagnostic, ChangeSummary } from '../providers/provider-plan.js'

// TODO: refactor this.

/**
 * Options for formatting the change set
 */
export interface FormatterOptions {
  /**
   * Whether to include diagnostics in the output
   */
  includeDiagnostics?: boolean
  /**
   * Whether to wrap the output in collapsible sections
   */
  collapsible?: boolean
  /**
   * Whether to wrap the output in diff format
   */
  diffFormat?: boolean
  /**
   * Custom exit code for error formatting
   */
  exitCode?: number
}

/**
 * The formatted output structure
 */
export interface FormattedOutput {
  /**
   * The formatted text output
   */
  text: string
  /**
   * Whether the plan has any changes
   */
  hasChanges: boolean
  /**
   * Whether the plan has any errors
   */
  hasErrors: boolean
}

/**
 * Default formatter for ProviderPlan objects
 * Based on the formatting logic from __temp/.build/common/projectRender.mjs
 */
export class DefaultFormatter {
  private static readonly OPERATION_SYMBOLS = {
    create: '+',
    update: '~',
    delete: '-',
    replace: '+-',
    'no-op': ' ',
  } as const

  /**
   * Format a ProviderPlan into a human-readable string
   */
  static _format(plan: ProviderPlan, options: FormatterOptions = {}): FormattedOutput {
    const { includeDiagnostics = true, collapsible = true, diffFormat = true, exitCode = 0 } = options

    const hasChanges = this.hasChanges(plan.changeSummary)
    const hasErrors = plan.diagnostics.some((d) => d.severity === 'error')
    const effectiveExitCode = hasErrors ? exitCode || 1 : 0

    const resources = this.formatResources(plan.resourceChanges)
    const table = this.buildTable(resources)
    const diagnostics =
      includeDiagnostics && effectiveExitCode !== 0 ? `\n\nDiagnostics:\n${this.formatErrors(plan.diagnostics)}` : ''

    const content = `${table}${diagnostics}`
    const header = `${plan.projectName} ${this.summaryToText(plan.changeSummary, plan.diagnostics)} ${this.exitCodeToText(effectiveExitCode)}`

    let formattedContent = ''
    if (hasChanges || hasErrors) {
      formattedContent = content
      if (diffFormat) {
        formattedContent = this.wrapAsDiff(formattedContent)
      }
      if (collapsible) {
        formattedContent = this.wrapAsCollapsibleSection(header, formattedContent)
      }
    }

    const workspacesPlan = plan.workspacesPlan ? this.formatWorkspaces(plan.workspacesPlan, { collapsible }) : null

    return {
      text: workspacesPlan ? `${formattedContent}\n\n${workspacesPlan.text}` : formattedContent,
      hasChanges: hasChanges || workspacesPlan?.hasChanges || false,
      hasErrors: hasErrors || workspacesPlan?.hasErrors || false,
    }
  }

  static format(plan: ProviderPlan): string {
    return this._format(plan).text
  }

  /**
   * Format multiple ProviderPlans (for workspaces)
   */
  static formatWorkspaces(plans: Record<string, ProviderPlan>, options: FormatterOptions = {}): FormattedOutput {
    const results = Object.entries(plans)
      .map(([workspaceName, plan]) => {
        const formatted = this._format(plan, { ...options })
        return { workspaceName, formatted }
      })
      .filter(({ formatted }) => formatted.hasChanges)

    const combinedText = results.map(({ formatted }) => formatted.text).join('\n\n')

    return {
      text: combinedText,
      hasChanges: results.length > 0,
      hasErrors: false, //TODO
    }
  }

  /**
   * Check if there are any changes in the summary
   */
  private static hasChanges(summary: ChangeSummary): boolean {
    return summary.add > 0 || summary.change > 0 || summary.remove > 0 || summary.replace > 0
  }

  /**
   * Format resource changes into a table structure
   */
  private static formatResources(changes: ResourceChange[]): Array<{
    op: string
    type: string
    name: string
    plan: string
    info: string
  }> {
    return changes.map((change) => {
      const primaryAction = change.actions[0] || 'no-op'
      const op = this.OPERATION_SYMBOLS[primaryAction as keyof typeof this.OPERATION_SYMBOLS] || ''

      return {
        op,
        type: change.type,
        name: change.name,
        plan: primaryAction,
        info: this.infoToText(change),
      }
    })
  }

  /**
   * Convert resource change info to text
   */
  private static infoToText(change: ResourceChange): string {
    const parts: string[] = []

    // Add action info
    if (change.actions.length > 1) {
      const actionSymbols = change.actions.map(
        (action) => this.OPERATION_SYMBOLS[action as keyof typeof this.OPERATION_SYMBOLS] || action,
      )
      parts.push(`[actions: ${actionSymbols.join(', ')}]`)
    }

    // Add status info if not pending
    if (change.status !== 'pending') {
      parts.push(`[status: ${change.status}]`)
    }

    return parts.join(' ')
  }

  /**
   * Build a formatted table from the data
   */
  private static buildTable(
    data: Array<{ op: string; type: string; name: string; plan: string; info: string }>,
  ): string {
    const headers = [
      { title: '', field: 'op' as const },
      { title: 'Type', field: 'type' as const },
      { title: 'Name', field: 'name' as const },
      { title: 'Plan', field: 'plan' as const },
      { title: 'Info', field: 'info' as const, hideIfEmpty: true },
    ]

    // Calculate column widths
    const colWidths = headers.map((h) => h.title.length)
    const dataWidths = this.getColumnWidths(headers, data)

    // Hide empty columns
    headers.forEach((h, index) => {
      if ('hideIfEmpty' in h && h.hideIfEmpty && dataWidths[index] === 0) {
        ;(h as { hide?: boolean }).hide = true
      }
    })

    // Final column widths
    const finalWidths = colWidths.map((w, index) => Math.max(w, dataWidths[index]))

    // Build header row
    const headerRow = headers
      .map((h, index) => {
        if ('hide' in h && (h as { hide?: boolean }).hide) return ''
        return (h.title || '').padEnd(finalWidths[index], ' ')
      })
      .filter(Boolean)
      .join(' ')

    // Build data rows
    const rows = data.map((obj) =>
      headers
        .map((h, index) => {
          if ('hide' in h && (h as { hide?: boolean }).hide) return ''
          const value = obj[h.field] ? String(obj[h.field]) : ''
          return value.padEnd(finalWidths[index], ' ')
        })
        .filter(Boolean)
        .join(' '),
    )

    return [headerRow, ...rows].join('\n')
  }

  /**
   * Get the maximum width of each column
   */
  private static getColumnWidths(
    headers: Array<{ field: string; title?: string }>,
    data: Array<Record<string, string>>,
  ): number[] {
    const colWidths: number[] = []

    for (const obj of data) {
      headers.forEach((h, index) => {
        const value = obj[h.field] ? String(obj[h.field]) : ''
        if (!colWidths[index]) {
          colWidths[index] = 0
        }
        colWidths[index] = Math.max(colWidths[index], value.length)
      })
    }

    return colWidths
  }

  /**
   * Format diagnostics/errors
   */
  private static formatErrors(diagnostics: Diagnostic[]): string {
    return diagnostics
      .map((diagnostic) => {
        const address = diagnostic.address ? ` (${diagnostic.address})` : ''
        return `  ${diagnostic.severity.toUpperCase()}${address}:\n    ${diagnostic.summary}`
      })
      .join('\n')
  }

  /**
   * Convert summary to text representation
   */
  private static summaryToText(summary: ChangeSummary, diagnostics: Diagnostic[] = []): string {
    const parts = [
      summary.add ? `{+ create: ${summary.add} +}` : '',
      summary.remove ? `{- delete: ${summary.remove} -}` : '',
      summary.change ? `{+ update: ${summary.change} +}` : '',
      summary.replace ? `{+- replace: ${summary.replace} +-}` : '',
      diagnostics.length ? `{- diagnostics: ${diagnostics.length} -}` : '',
    ].filter(Boolean)

    return parts.join('\n')
  }

  /**
   * Convert exit code to text representation
   */
  private static exitCodeToText(exitCode: number): string {
    return exitCode === 0 ? '' : `{-error (code: ${exitCode}) -}`
  }

  /**
   * Wrap content in diff format
   */
  private static wrapAsDiff(content: string): string {
    return `\`\`\`diff\n${content.trimEnd()}\n\`\`\`\n`
  }

  /**
   * Wrap content in collapsible section
   */
  private static wrapAsCollapsibleSection(title: string, content: string): string {
    return `<details><summary>${title}</summary>\n\n${content}</details>\n`
  }
}
