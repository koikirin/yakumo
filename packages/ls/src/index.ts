import kleur from 'kleur'
import { Context } from 'yakumo'

export const inject = ['yakumo']

export function apply(ctx: Context) {
  ctx.register('ls', async () => {
    const paths = ctx.yakumo.locate(ctx.yakumo.argv._)
    for (const name of paths) {
      const json = ctx.yakumo.workspaces[name]
      console.log(`${kleur.green(json.name)} -> ${kleur.cyan(name)}`)
    }
    console.log(kleur.yellow(`Total: ${kleur.bold(paths.length)} workspaces.`))
  })
}
