import { DefaultFormatter } from './default-formatter.js'
import type { IFormatter } from './formatter.js'

export function getFormatter(name?: string): IFormatter {
  if (!name) {
    return DefaultFormatter
  }
  switch (name) {
    case 'default':
      return DefaultFormatter
    default:
      throw new Error(`Formatter ${name} not found`)
  }
}
