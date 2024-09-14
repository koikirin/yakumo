import * as cordis from 'cordis'
import globby from 'globby'
import yargs from 'yargs-parser'
import detect from 'detect-indent'
import { Arguments, Context, LocateOptions, Manager, Options, PackageJson } from 'yakumo'
import { manager, spawnAsync } from 'yakumo/utils'
import kleur from 'kleur'
import { promises as fs, readFileSync } from 'node:fs'
import { deduplicate, Dict, makeArray, noop } from 'cosmokit'
import { } from '@cordisjs/loader'
import { } from 'yakumo-locate'
import { } from 'yakumo-yargs'

export * from 'yakumo'
export type { } from 'yakumo-yargs'

export const cwd = process.cwd()
const content = readFileSync(`${cwd}/package.json`, 'utf8')
export const meta: PackageJson = JSON.parse(content)

export namespace Yakumo {
  export interface Intercept {
    alias?: Dict<string | string[]>
    exclude?: string[]
  }

  export interface Config extends Intercept {
    commands?: Dict
    pipeline?: Dict<string[]>
  }
}

const builtinServices = {
  'locate': 'yakumo-locate',
  'yargs': 'yakumo-yargs',
}

const builtinCommands = Object.assign(Object.create(null), {
  'list': 'yakumo/list',
  'prepare': 'yakumo/prepare',
  'publish': 'yakumo/publish',
  'test': 'yakumo/test',
  'upgrade': 'yakumo/upgrade',
  'version': 'yakumo/version',
  'run': 'yakumo/run',
  'ls': 'yakumo-ls',
  'git': 'yakumo-git',
})

export default class Yakumo extends cordis.Service<Yakumo.Config, Context> {
  static inject = ['loader']

  cwd: string
  argv!: Arguments
  manager: Manager
  workspaces!: Dict<PackageJson>
  indent = detect(content).indent
  commands: Dict = {}

  constructor(public ctx: Context, public config: Yakumo.Config) {
    super(ctx, 'yakumo', true)
    ctx.mixin('yakumo', ['register'])
    this.cwd = cwd
    this.manager = manager

    for (const name in config.pipeline || {}) {
      this.register(name, async (...rest: any[]) => {
        const tasks = config.pipeline![name]
        for (const task of tasks) {
          const [name, ...args] = task.split(/\s+/g)
          await this.execute(name, ...args, ...rest)
        }
      })
    }

    Object.values(builtinServices).forEach(name => ctx.loader.root.create({ name }))
  }

  register(name: string, callback: () => void, options: Options = {}) {
    this.commands[name] = [callback, options]
  }

  async initialize() {
    const folders = await globby(meta.workspaces || [], {
      cwd,
      onlyDirectories: true,
      expandDirectories: false,
    })
    folders.unshift('')

    this.workspaces = Object.fromEntries((await Promise.all(folders.map(async (path) => {
      if (path) path = '/' + path
      try {
        const content = await fs.readFile(`${cwd}${path}/package.json`, 'utf8')
        return [path, JSON.parse(content)] as [string, PackageJson]
      } catch {}
      return null! // workaround silly strictNullChecks
    }))).filter(Boolean))
  }

  resolveIntercept(): Yakumo.Intercept {
    let result = this.config
    let intercept = this.ctx[Context.intercept]
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
      }
      intercept = Object.getPrototypeOf(intercept)
    }
    return result
  }

  locate(name: string | string[], options: LocateOptions = {}): string[] {
    const { alias, exclude } = this.resolveIntercept()
    const defaultFilter = options.filter || ((meta) => options.includeRoot || !meta.workspaces)
    const filter = (meta: PackageJson, path: string) => {
      return defaultFilter(meta, path) && !exclude?.some((pattern) => {
        return new RegExp('^/' + pattern.replace(/\*/g, '[^/]+') + '$').test(path)
      })
    }
    if (Array.isArray(name)) {
      if (!name.length) {
        return Object.keys(this.workspaces).filter((folder) => {
          return filter(this.workspaces[folder], folder)
        })
      } else {
        return deduplicate(name.flatMap((name) => this.locate(name, options)))
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

    const targets = Object.keys(this.workspaces).filter((folder) => {
      if (!filter(this.workspaces[folder], folder)) return
      return folder.endsWith('/' + name)
    })

    if (!targets.length) {
      throw new Error(`cannot find workspace "${name}"`)
    } else if (targets.length > 1) {
      throw new Error(`ambiguous workspace "${name}": ${targets.join(', ')}`)
    }

    return targets
  }

  async save(path: string) {
    const content = JSON.stringify(this.workspaces[path], null, this.indent) + '\n'
    await fs.writeFile(`${cwd}${path}/package.json`, content)
  }

  async execute(name: string, ...args: string[]) {
    await this.ctx.events.flush()
    if (!this.commands[name]) {
      if (name in builtinCommands) {
        await this.ctx.loader.create({
          name: builtinCommands[name],
        })
        return this.execute(name, ...args)
      }
      console.error(kleur.red(`unknown command: ${name}`))
      process.exit(1)
    }

    const [callback, options] = this.commands[name]
    const argv = this.yargs(args, options) as Arguments
    await this.initialize()
    if (!name.startsWith('yakumo:') && name !== 'run') {
      await this.execute('run', ...argv._, '--', `yakumo:before:${name}`).catch(noop)
    }
    argv.config = options
    this.argv = argv
    await callback(...args)
    if (!name.startsWith('yakumo:') && name !== 'run') {
      await this.execute('run', ...argv._, '--', `yakumo:after:${name}`).catch(noop)
    }
  }

  yargs(argv: string | string[], opts: Options = {}) {
    (opts.configuration ??= {})['populate--'] = true
    return this.ctx.get('yargs')?.parse(argv, opts) ?? yargs(argv, opts)
  }

  async start() {
    if (this.ctx.loader.config.name !== 'yakumo') return
    const [name, ...args] = process.argv.slice(2)
    if (!name) {
      console.log('yakumo')
      process.exit(0)
    }
    await new Promise(resolve => this.ctx.inject(Object.keys(builtinServices), resolve))
    this.execute(name, ...args)
  }

  async install() {
    const agent = manager?.name || 'npm'
    const code = await spawnAsync([agent, 'install'])
    if (code) process.exit(code)
  }
}
