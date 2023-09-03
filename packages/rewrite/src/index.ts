import { remove } from 'cosmokit'
import { addHook } from 'yakumo'
import {} from 'yakumo-core-patch'

declare module 'yakumo' {
  export interface ProjectConfig {
    rewrite?: RewriteConfig[]
  }
}

export interface RewriteConfig {
  match: string
  rules: RewriteRule[]
  preserve: boolean
}

export interface RewriteRule {
  source: string
  target: string
}

addHook('execute.prepare', async function () {
  if (!this.argv._.length || this.argv.config.manual) {
    return
  }

  const args = this.argv._
  for (const { match, rules = [], preserve = true } of this.config.rewrite || []) {
    const matcher = new RegExp(match)
    args.forEach((arg: string) => {
      if (matcher.test(arg)) {
        if (!preserve) remove(this.argv._, arg)
        rules.forEach(({ source, target }) => this.argv._.push(
          arg.replace(new RegExp(source), target),
        ))
      }
    })
  }
})
