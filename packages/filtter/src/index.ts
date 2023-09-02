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

addHook('execute.before', async (project, name) => {
  const expr = project.config.commands?.[name]?.['filter-targets']
  if (!expr) return
  project.targets = Object.fromEntries(Object.entries(project.targets).filter(([path, json]) => {
    return executeEval({ _: { path, ...json } }, expr)
  }))
})
