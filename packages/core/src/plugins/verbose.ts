import { Context } from '../index.js'

export const inject = ['yakumo']

export function apply(ctx: Context) {
  ctx.register('verbose', async (name: string, ...rest: string[]) => {
    ctx.yakumo.config.verbose = true
    return ctx.yakumo.execute(name, ...rest)
  })
}
