import { Service } from 'cordis'
import { Arguments, Context, Options } from 'yakumo'
import parse, { Options as ParserOptions } from 'yargs-parser'
import unparse from 'yargs-unparser'
import yargs, { Argv } from 'yargs'

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
  unparse(argv: Arguments, opts?: Options): string[]
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
    const res = opts?.argv ? opts.argv.parseSync(argv) : parse(argv, opts)
    res.config = opts
    return res
  }

  unparse(argv: Arguments, opts?: any) {
    return unparse({ ...argv, config: undefined }, opts)
  }
}

export default YargsService
