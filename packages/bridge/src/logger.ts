type Level = 'silent' | 'error' | 'warn' | 'info' | 'debug'

const order: Record<Level, number> = {
  silent: 99,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

class Logger {
  private level: Level = 'info'

  setLevel(level: Level) {
    this.level = level
  }

  private should(level: Level) {
    return order[level] <= order[this.level]
  }

  private write(level: Level, msg: string) {
    if (!this.should(level)) return
    const prefix = level === 'debug' ? '[debug] ' : level === 'warn' ? '[warn] ' : level === 'error' ? '[error] ' : ''
    process.stderr.write(`${prefix}${msg}\n`)
  }

  error(msg: string) {
    this.write('error', msg)
  }
  warn(msg: string) {
    this.write('warn', msg)
  }
  info(msg: string) {
    this.write('info', msg)
  }
  debug(msg: string) {
    this.write('debug', msg)
  }
}

export const logger = new Logger()
