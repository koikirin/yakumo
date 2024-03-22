import { makeArray } from 'cosmokit'
import Yakumo, { Context, LocateOptions, PackageJson } from 'yakumo'
import { Eval, executeEval } from 'minato'

export const inject = ['yakumo']

declare module 'yakumo' {
  interface LocateOptions {
    folder?: boolean
    package?: boolean
  }

  namespace Yakumo {
    interface Intercept {
      filters?: Eval.Expr<boolean>[]
    }

    interface Augument {
      locate?: LocateOptions
    }
  }
}

function resolveIntercept(this: Yakumo) {
  const caller = this[Context.current]
  let result = this.config
  let intercept = caller[Context.intercept]
  while (intercept) {
    result = {
      ...result,
      ...intercept.yakumo,
      alias: {
        ...result.alias,
        ...intercept.yakumo?.alias,
      },
      exclude: [
        ...result.exclude || [],
        ...intercept.yakumo?.exclude || [],
      ],
      filters: [
        ...result.filters || [],
        ...intercept.yakumo?.filters || [],
      ],
    }
    intercept = Object.getPrototypeOf(intercept)
  }
  return result
}

function locate(this: Yakumo, name: string | string[], options: LocateOptions = {}) {
  const o: LocateOptions = { folder: true, package: true, ...this.argv.locate || {}, ...options }
  const { alias, exclude, filters } = resolveIntercept.apply(this)
  const defaultFilter = o.filter || ((meta) => o.includeRoot || !meta.workspaces)
  const filter = (meta: PackageJson, path: string) => {
    return defaultFilter(meta, path) && !exclude?.some((pattern) => {
      const matcher = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$')
      return (o.folder && (path.endsWith('/' + name) || matcher.test(path) || matcher.test(path && path.slice(1))))
      || (o.package && ((pattern.startsWith('!') ? (name.slice(1) === meta.name) : matcher.test(meta.name))))
    }) && (!filters?.length || filters.some((expr) => executeEval({ _: { path, ...meta } }, expr)))
  }
  if (Array.isArray(name)) {
    if (!name.length) {
      return Object.keys(this.workspaces).filter((folder) => {
        return filter(this.workspaces[folder], folder)
      })
    } else {
      return name.flatMap((name) => this.locate(name, o))
    }
  }

  if (alias?.[name]) {
    return makeArray(alias[name]).map((path) => {
      if (!this.workspaces[path]) {
        throw new Error(`cannot find workspace ${path} resolved by ${name}`)
      }
      return path
    })
  }

  const matcher = new RegExp('^' + name.replace(/\*/g, '[^/]+') + '$')
  const targets = Object.keys(this.workspaces).filter((folder) => {
    if (!filter(this.workspaces[folder], folder)) return
    const meta = this.workspaces[folder]
    const [last] = meta.name.split('/').reverse()
    return (o.folder && (folder.endsWith('/' + name) || matcher.test(folder) || matcher.test(folder && folder.slice(1))))
      || (o.package && ((name.startsWith('!') ? (name.slice(1) === meta.name) : (matcher.test(meta.name) || matcher.test(last)))))
  }).filter((folder) => {
    return filter(this.workspaces[folder], folder)
  })

  if (!targets.length) {
    throw new Error(`cannot find workspace "${name}"`)
  }

  return targets
}

export function apply(ctx: Context) {
  ctx.effect(() => {
    const oldLocate = ctx.yakumo.locate
    ctx.yakumo.locate = locate
    return () => ctx.yakumo.locate = oldLocate
  })
}
