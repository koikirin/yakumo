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

addHook('execute.prepare', async (project, name) => {
  const parent = name.split('/')[0]
  const expr = project.config.commands?.[name]?.['filter-targets'] ?? project.config.commands?.[parent]?.['filter-targets']
  if (!expr) return
  project.targets = Object.fromEntries(Object.entries(project.targets).filter(([path, json]) => {
    return executeEval({ _: { path, ...json } }, expr)
  }))
})
