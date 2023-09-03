import { addHook } from 'yakumo'
import { Eval, executeEval } from '@minatojs/core'
import {} from 'yakumo-core-patch'

declare module 'yakumo' {
  export interface Commands {
    [key: string]: FilterConfig
  }
}

export interface FilterConfig {
  'filter-targets'?: Eval.Expr<boolean>
}

addHook('execute.prepare', async function (path) {
  const parent = path.split('/')[0]
  const expr = this.config.commands?.[path]?.['filter-targets'] ?? this.config.commands?.[parent]?.['filter-targets']
  if (!expr) return
  this.targets = Object.fromEntries(Object.entries(this.targets).filter(([name, json]) => {
    return executeEval({ _: { path: name, ...json } }, expr)
  }))
})
