import kleur from 'kleur'
import { Context } from '../index.js'

export const inject = ['yakumo']

export function apply(ctx: Context) {
  ctx.register('verbose', async (name: string, ...rest: string[]) => {
    ctx.yakumo.config.verbose = true
    const dispose = ctx.on('yakumo/before-execute', async (name: string, ...args: string[]) => {
      console.log(kleur.grey(['$', name, ...args].join(' ')))
    })
    await ctx.yakumo.execute(name, ...rest)
    dispose()
  })
}
