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

addHook('execute.prepare', (project) => {
  if (!project.argv._.length || project.argv.config.manual) {
    return
  }

  const args = project.argv._
  for (const { match, rules = [], preserve = true } of project.config.rewrite || []) {
    const matcher = new RegExp(match)
    args.forEach((arg: string) => {
      if (matcher.test(arg)) {
        if (!preserve) remove(project.argv._, arg)
        rules.forEach(({ source, target }) => project.argv._.push(
          arg.replace(new RegExp(source), target),
        ))
      }
    })
  }
})
