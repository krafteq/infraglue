import { DefaultFormatter } from './default-formatter.js'
import type { IFormatter } from './formatter.js'
import { UserError } from '../utils/index.js'

export function getFormatter(name?: string): IFormatter {
  if (!name) {
    return DefaultFormatter
  }
  switch (name) {
    case 'default':
      return DefaultFormatter
    default:
      throw new UserError(`Unknown formatter '${name}'. Available: default.`)
  }
}
