import { Service } from 'cordis'
import { Context, Options } from 'yakumo'
import parse, { Options as ParserOptions } from 'yargs-parser'
import unparse from 'yargs-unparser'
import yargs, { Arguments, Argv } from 'yargs'

declare module 'yakumo' {
  interface Context {
    yargs: YargsService
  }

  interface Options {
    argv?: Argv
  }
}

declare module 'yargs' {
  interface Argv {
    getOptions(): ParserOptions
    build<T extends ParserOptions>(config?: T): T
  }
}

export interface YargsService {
  (): Argv
  declare(name: string, argv: Argv): void
  parse(argv: string | string[], opts: Options): Arguments
  unparse: typeof unparse
}

export class YargsService extends Service<unknown, Context> {
  static inject = { optional: ['yakumo'] }

  constructor(ctx: Context) {
    super(ctx, 'yargs')
  }

  [Service.invoke]() {
    const argv = yargs()
    argv.build = <T extends ParserOptions>(config?: T) => ({ argv, ...argv.getOptions(), ...config }) as any
    return argv
  }

  declare(name: string, argv: Argv) {
    if (this.ctx.yakumo.commands[name]) {
      if (this.ctx.yakumo.commands[name][1]) {
        this.ctx.yakumo.commands[name][1].argv ||= argv
      } else {
        this.ctx.yakumo.commands[name][1] = { argv }
      }
      return true
    } else return false
  }

  parse(argv: string | string[], opts: Options) {
    if (opts?.argv) return opts.argv.parseSync(argv)
    return parse(argv, opts)
  }

  unparse = unparse
}

export default YargsService
