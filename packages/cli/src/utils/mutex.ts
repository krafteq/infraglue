export class Mutex {
  private _locked = false
  private _waiting: (() => void)[] = []

  public async lock(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryLock = () => {
        if (!this._locked) {
          this._locked = true
          resolve(this.unlock.bind(this))
        } else {
          this._waiting.push(tryLock)
        }
      }
      tryLock()
    })
  }

  private unlock() {
    if (this._waiting.length > 0) {
      const next = this._waiting.shift()
      if (next) next()
    } else {
      this._locked = false
    }
  }
}
