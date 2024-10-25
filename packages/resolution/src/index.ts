import kleur from 'kleur'
import { Context } from 'yakumo'

export const inject = ['yakumo']

declare module 'yakumo' {
  export interface PackageJson {
    resolutions?: Record<string, string>
  }
}

export function apply(ctx: Context) {
  ctx.register('resolution', async () => {
    const paths = ctx.yakumo.locate(ctx.yakumo.argv._, {
      includeRoot: true,
    }).map(x => x.endsWith('/') ? x : x + '/')
    const rootMeta = ctx.yakumo.workspaces['']

    rootMeta.resolutions ??= {}

    for (const [name, json] of Object.entries(ctx.yakumo.workspaces)) {
      if (!paths.some(path => name.startsWith(path))) continue
      rootMeta.resolutions[json.name] ??= 'workspace:*'
      console.log(`Resolving ${kleur.cyan(json.name)} to ${rootMeta.resolutions[json.name]}`)
    }
    ctx.yakumo.save('')
    console.log(kleur.green('Successfully updated resolutions.'))
  })
}
