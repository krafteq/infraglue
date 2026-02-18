import pc from 'picocolors'

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
  setVerbose() {
    this.level = 'debug'
  }
  setQuiet() {
    this.level = 'silent'
  }
  isVerbose() {
    return this.should('debug')
  }

  private should(level: Level) {
    return order[level] <= order[this.level]
  }

  private write(level: Level, msg: string) {
    if (!this.should(level)) return
    const colored = level === 'error' ? pc.red(msg) : level === 'warn' ? pc.yellow(msg) : msg
    process.stderr.write(`${colored}\n`)
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
