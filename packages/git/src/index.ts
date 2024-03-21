import { isAbsolute, join, relative, resolve } from 'path'
import { SimpleGit, simpleGit } from 'simple-git'
import kleur from 'kleur'
import { Context, Options } from 'yakumo'
import { } from 'yakumo-yargs'

type RepoPolicy = 'parallel' | 'sequential' | 'single'

type Action = (name: string, git: SimpleGit) => Promise<boolean>

function isSubdirectoryOf(dir: string, parent: string) {
  const relpath = relative(parent, dir)
  return relpath && !relpath.startsWith('..') && !isAbsolute(relpath)
}

export default class YakumoGit {
  static inject = ['yakumo', 'yargs']

  paths: string[] = []
  globalYargs: any
  subcommands: Record<string, [Action, Options, RepoPolicy]> = Object.create(null)

  constructor(private ctx: Context) {
    this.globalYargs = this.yargs()

    this.registerSubcommand('status', async (path, git) => {
      const packageRoot = resolve(process.cwd(), path.slice(1)),
        gitRoot = (await git.raw('rev-parse', '--git-dir')).trim().slice(0, -4) || packageRoot,
        relRoot = relative(gitRoot, packageRoot)

      const s = await git.status()
      const files = s.files
        .filter(f => isSubdirectoryOf(f.path, relRoot) && (f.path = relative(relRoot, f.path)))
        .filter(f => !ctx.yakumo.argv.workingDirectories || ctx.yakumo.argv.workingDirectories.includes(f.working_dir))
        .map(f => `${(kleur.yellow(f.working_dir))} ${f.path} ${kleur.grey('->')} ${(join(path.slice(1), f.path))}`)
      if (files.length) {
        console.log(kleur.cyan(path), kleur.yellow(s.current!))
        console.log(files.join('\n'))
      }
      return true
    }, this.yargs().option('workingDirectories', { type: 'string', alias: 'W' }).build(), 'parallel')

    this.registerSubcommand('fetch', async (path, git) => {
      await git.fetch()
      return true
    }, this.yargs().build(), 'single')

    this.registerSubcommand('pull', async (path, git) => {
      await git.pull(this.ctx.yakumo.argv.remote, this.ctx.yakumo.argv.branch)
      return true
    }, this.yargs().option('remote', { type: 'string' }).option('branch', { type: 'string' }).build(), 'single')

    this.registerSubcommand('add', async (path, git) => {
      await git.add('.')
      return true
    }, this.yargs().build(), 'sequential')

    this.registerSubcommand('commit', async (path, git) => {
      const res = await git.commit(this.ctx.yakumo.argv.message)
      return !!res.commit
    }, this.yargs().option('message', { type: 'string', alias: 'm', default: '' }).build(), 'single')

    this.registerSubcommand('push', async (path, git) => {
      const r = await git.push(this.ctx.yakumo.argv.remote, this.ctx.yakumo.argv.branch)
      return !r.pushed.length
    }, this.yargs().option('remote', { type: 'string' }).option('branch', { type: 'string' }).build(), 'single')

    this.registerSubcommand('acp', async (path, git) => {
      const r = await git
        .add('.')
        .commit(this.ctx.yakumo.argv.message)
        .push(this.ctx.yakumo.argv.remote, this.ctx.yakumo.argv.branch)
      return !r.pushed.length
    }, ctx.yargs()
      .option('message', { type: 'string', alias: 'm', default: '' })
      .option('remote', { type: 'string' })
      .option('branch', { type: 'string' })
      .build(), 'sequential')

    this.registerSubcommand('chore', async (path, git) => {
      const s = await git.status()
      const files = s.files
        .filter(f => ['M', ' '].includes(f.working_dir) && f.path.split('/').reverse()[0] === 'package.json')
        .map(f => f.path)
      if (files.length) {
        await git.add(files).commit(this.ctx.yakumo.argv.message || 'chore: bump versions')
        return true
      }
      return false
    }, this.yargs().option('message', { type: 'string', alias: 'm', default: '' }).build(), 'sequential')

    ctx.register('git', async () => {
      const subcommand = ctx.yakumo.argv._.shift()
      if (!subcommand || !this.subcommands[subcommand]) {
        this.globalYargs.showHelp()
        return
      }
      const [action, options, policy] = this.subcommands[subcommand]

      this.paths = ctx.yakumo.locate(ctx.yakumo.argv._)
      this.ctx.yakumo.argv = { config: options, ...ctx.yargs.parse(ctx.yargs.unparse(this.ctx.yakumo.argv), options) } as any

      await this.runAction(action, policy)
    }, this.globalYargs.build())
  }

  async getRepositoryRoot(name: string, git?: SimpleGit) {
    if (!name || !this.ctx.yakumo.workspaces[name]) return
    git ??= simpleGit(name.slice(1))

    const gitDir = await git.raw('rev-parse', '--git-dir')
    if (gitDir.trim().startsWith('fatal:') ? false
      : (gitDir.trim() === '.git') ? !this.ctx.yakumo.workspaces[name].workspaces || this.ctx.yakumo.argv.root || this.ctx.yakumo.argv.rootOnly
        : !this.ctx.yakumo.argv.rootOnly) {
      return gitDir.trim().slice(0, -4) ? resolve(gitDir.trim().slice(0, -4))
        : resolve(process.cwd(), name.slice(1))
    }
  }

  yargs() {
    return this.ctx.yargs()
      .scriptName('yakumo git')
      .option('root', { type: 'boolean', alias: 'r' })
      .option('rootOnly', { type: 'boolean', alias: 'R' })
      .option('dry', { type: 'boolean' })
      .default('includeRoot', true)
  }

  async runAction(action: Action, policy: RepoPolicy) {
    const gitMap: Record<string, string[]> = {}

    await Promise.all(
      this.paths.map(async path => {
        if (!path) return false
        const repoRoot = await this.getRepositoryRoot(path)
        if (!repoRoot) return false
        ;(gitMap[repoRoot] ||= []).push(path)
      }),
    )

    const counter = (await Promise.all(
      Object.entries(gitMap).map(async ([, paths]) => {
        if (policy === 'sequential') {
          let cnt = 0
          for (const path of paths) {
            const git: SimpleGit = simpleGit(path.slice(1))
            try {
              cnt += await action(path, git) ? 1 : 0
            } catch (e) {
              console.log(kleur.red(path), e)
            }
          }
          return cnt
        } else if (policy === 'parallel') {
          return (await Promise.all(paths.map(async path => {
            const git: SimpleGit = simpleGit(path.slice(1))
            try {
              return await action(path, git)
            } catch (e) {
              console.log(kleur.red(path), e)
            }
          }))).filter(x => x).length
        } else if (policy === 'single') {
          const path = paths[0]
          const git: SimpleGit = simpleGit(path.slice(1))
          try {
            return await action(path, git) ? 1 : 0
          } catch (e) {
            console.log(kleur.red(path), e)
          }
        }
        return 0
      }),
    )).reduce((x, y) => x + y, 0)

    console.log(kleur.green(`Successfully processed ${counter} repositories`))
  }

  registerSubcommand(cmd: string, action: Action, options: Options = {}, policy: RepoPolicy = 'sequential') {
    this.subcommands[cmd] = [action, options, policy]
    this.globalYargs.command(cmd, '')
    this.ctx.register(`git/${cmd}`, () => this.runAction(action, policy), options)
  }
}
