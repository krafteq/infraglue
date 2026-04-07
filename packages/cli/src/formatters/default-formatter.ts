import type { ProviderPlan, ResourceChange, Diagnostic, ChangeSummary, Output } from '../providers/provider-plan.js'
import { diffAttributes } from '../core/plan-diff.js'
import pc from 'picocolors'

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
    const outputs = this.formatOutputs(plan.outputs)
    const table = this.buildTableWithPropertyDiffs(resources, plan.resourceChanges)
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
      } else {
        formattedContent = `${header}\n${formattedContent}`
      }
    }

    if (outputs) {
      formattedContent += `\n\nOutputs:\n${outputs}`
    }

    const workspacesPlan = plan.workspacesPlan ? this.formatWorkspaces(plan.workspacesPlan, { collapsible }) : null

    return {
      text: workspacesPlan ? `${formattedContent}\n\n${workspacesPlan.text}` : formattedContent,
      hasChanges: hasChanges || workspacesPlan?.hasChanges || false,
      hasErrors: hasErrors || workspacesPlan?.hasErrors || false,
    }
  }

  static format(plan: ProviderPlan): string {
    return this._format(plan, { collapsible: false, diffFormat: false }).text
  }

  static formatForMarkdown(plan: ProviderPlan): string {
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

  private static formatOutputs(outputs: Output[]): string {
    return outputs
      .filter((output) => output.action)
      .map((output) => {
        const outputText = output.sensitive ? '***' : output.value
        return `  [${output.action}] ${output.name}: ${outputText}`
      })
      .join('\n')
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
          const padded = value.padEnd(finalWidths[index], ' ')
          if (h.field === 'op' && value.trim()) {
            return this.colorizeOp(value, finalWidths[index])
          }
          return padded
        })
        .filter(Boolean)
        .join(' '),
    )

    return [headerRow, ...rows].join('\n')
  }

  /**
   * Build a table with property diff lines interleaved after update/replace resources
   */
  private static buildTableWithPropertyDiffs(
    data: Array<{ op: string; type: string; name: string; plan: string; info: string }>,
    changes: ResourceChange[],
  ): string {
    const table = this.buildTable(data)
    const tableLines = table.split('\n')
    const result: string[] = [tableLines[0]] // header

    for (let i = 0; i < changes.length; i++) {
      result.push(tableLines[i + 1])
      result.push(...this.formatPropertyDiffLines(changes[i]))
    }

    return result.join('\n')
  }

  /**
   * Format property-level diff lines for a resource change
   */
  private static formatPropertyDiffLines(change: ResourceChange): string[] {
    if (!change.actions.some((a) => a === 'update' || a === 'replace')) return []
    if (!change.before || !change.after) return []

    const diffs = diffAttributes(change.before, change.after)
    if (diffs.length === 0) return []

    return diffs.map((diff) => {
      const isAdded = diff.before === undefined
      const isRemoved = diff.after === undefined
      const symbol = isAdded ? '+' : isRemoved ? '-' : '~'
      const color = isAdded ? pc.green : isRemoved ? pc.red : pc.yellow
      return `      ${color(symbol + ' ' + diff.key)}`
    })
  }

  /**
   * Colorize op symbol while preserving column width
   */
  private static colorizeOp(op: string, width: number): string {
    const padding = ' '.repeat(Math.max(0, width - op.length))
    switch (op.trim()) {
      case '+':
        return pc.green(op) + padding
      case '-':
        return pc.red(op) + padding
      case '~':
      case '+-':
        return pc.yellow(op) + padding
      default:
        return op + padding
    }
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
      summary.add ? pc.green(`+${summary.add} create`) : '',
      summary.remove ? pc.red(`-${summary.remove} delete`) : '',
      summary.change ? pc.yellow(`~${summary.change} update`) : '',
      summary.replace ? pc.yellow(`+-${summary.replace} replace`) : '',
      diagnostics.length ? pc.red(`${diagnostics.length} diagnostics`) : '',
    ].filter(Boolean)

    return parts.join(', ')
  }

  /**
   * Convert exit code to text representation
   */
  private static exitCodeToText(exitCode: number): string {
    return exitCode === 0 ? '' : pc.red(`error (code: ${exitCode})`)
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
