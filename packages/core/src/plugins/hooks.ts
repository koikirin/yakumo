import { Arguments, Context } from '../index.js'

export const inject = ['yakumo']

export function apply(ctx: Context) {
  if (ctx.yakumo.config.hooks) {
    ctx.on('yakumo/before-execute', async function (this: Arguments, name: string, ...args: string[]) {
      if (!name.startsWith('yakumo:') && name !== 'run') {
        await ctx.yakumo.execute('run', ...this._, '--', `yakumo:before:${name}`)
          .catch((err: any) => name !== 'verbose' && ctx.yakumo.config.verbose && console.warn(err))
      }
    })
    ctx.on('yakumo/after-execute', async function (this: Arguments, name: string, ...args: string[]) {
      if (!name.startsWith('yakumo:') && name !== 'run') {
        await ctx.yakumo.execute('run', ...this._, '--', `yakumo:after:${name}`)
          .catch((err: any) => name !== 'verbose' && ctx.yakumo.config.verbose && console.warn(err))
      }
    })
  }

  ctx.set('yakumo/hooks', true)
}
