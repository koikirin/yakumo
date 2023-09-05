import { isAbsolute, join, relative, resolve } from 'path'
import { SimpleGit, simpleGit } from 'simple-git'
import { cyan, green, grey, red, yellow } from 'kleur'
import { Options, Project, register } from 'yakumo'
import { parse, unparse, yargs as yargs_ } from 'yakumo-core-patch'
import {} from 'yakumo-locate'

function isSubdirectoryOf(dir: string, parent: string) {
  const relpath = relative(parent, dir)
  return relpath && !relpath.startsWith('..') && !isAbsolute(relpath)
}

async function getRepositoryRoot(project: Project, name: string, git?: SimpleGit) {
  if (!name || !project.targets[name]) return
  git ??= simpleGit(name.slice(1))

  const gitDir = await git.raw('rev-parse', '--git-dir')
  if (gitDir.trim().startsWith('fatal:') ? false
    : (gitDir.trim() === '.git') ? !project.targets[name].workspaces || project.argv.root || project.argv.rootOnly
      : !project.argv.rootOnly) {
    return gitDir.trim().slice(0, -4) ? resolve(gitDir.trim().slice(0, -4))
      : resolve(process.cwd(), name.slice(1))
  }
}

type RepoPolicy = 'parallel' | 'sequential' | 'single'

type Action = (project: Project, name: string, git: SimpleGit) => Promise<boolean>

const subcommands: Record<string, [Action, Options, RepoPolicy]> = {}

function yargs() {
  return yargs_()
    .scriptName('yakumo git')
    .option('root', { type: 'boolean', alias: 'r' })
    .option('rootOnly', { type: 'boolean', alias: 'R' })
    .option('dry', { type: 'boolean' })
    .default('locate.root', true)
}

async function runAction(project: Project, action: Action, policy: RepoPolicy) {
  const gitMap: Record<string, string[]> = {}

  await Promise.all(
    Object.keys(project.targets).map(async path => {
      if (!path) return false
      const repoRoot = await getRepositoryRoot(project, path)
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
            cnt += await action(project, path, git) ? 1 : 0
          } catch (e) {
            console.log(red(path), e)
          }
        }
        return cnt
      } else if (policy === 'parallel') {
        return (await Promise.all(paths.map(async path => {
          const git: SimpleGit = simpleGit(path.slice(1))
          try {
            return await action(project, path, git)
          } catch (e) {
            console.log(red(path), e)
          }
        }))).filter(x => x).length
      } else if (policy === 'single') {
        const path = paths[0]
        const git: SimpleGit = simpleGit(path.slice(1))
        try {
          return await action(project, path, git) ? 1 : 0
        } catch (e) {
          console.log(red(path), e)
        }
      }
      return 0
    }),
  )).reduce((x, y) => x + y, 0)

  console.log(green(`Successfully processed ${counter} repositories`))
}

const globalYargs = yargs()

function registerSubcommand(cmd: string, action: Action, options: Options = {}, policy: RepoPolicy = 'sequential') {
  subcommands[cmd] = [action, options, policy]
  globalYargs.command(cmd, '')
  register(`git/${cmd}`, (project) => runAction(project, action, policy), options)
}

registerSubcommand('status', async (project, path, git) => {
  const packageRoot = resolve(process.cwd(), path.slice(1)),
    gitRoot = (await git.raw('rev-parse', '--git-dir')).trim().slice(0, -4) || packageRoot,
    relRoot = relative(gitRoot, packageRoot)

  const s = await git.status()
  const files = s.files
    .filter(f => isSubdirectoryOf(f.path, relRoot) && (f.path = relative(relRoot, f.path)))
    .filter(f => !project.argv.workingDirectories || project.argv.workingDirectories.includes(f.working_dir))
    .map(f => `${(yellow(f.working_dir))} ${f.path} ${grey('->')} ${(join(path.slice(1), f.path))}`)
  if (files.length) {
    console.log(cyan(path), yellow(s.current))
    console.log(files.join('\n'))
  }
  return true
}, yargs().option('workingDirectories', { type: 'string', alias: 'W' }).build(), 'parallel')

registerSubcommand('fetch', async (project, path, git) => {
  await git.fetch()
  return true
}, yargs().build(), 'single')

registerSubcommand('pull', async (project, path, git) => {
  await git.pull(project.argv.remote, project.argv.branch)
  return true
}, yargs().option('remote', { type: 'string' }).option('branch', { type: 'string' }).build(), 'single')

registerSubcommand('add', async (project, path, git) => {
  await git.add('.')
  return true
}, yargs().build(), 'sequential')

registerSubcommand('commit', async (project, path, git) => {
  const res = await git.commit(project.argv.message)
  return !!res.commit
}, yargs().option('message', { type: 'string', alias: 'm', default: '' }).build(), 'single')

registerSubcommand('push', async (project, path, git) => {
  if ((await git.status()).isClean()) {
    await git.push(project.argv.remote, project.argv.branch)
    return true
  }
}, yargs().option('remote', { type: 'string' }).option('branch', { type: 'string' }).build(), 'single')

registerSubcommand('acp', async (project, path, git) => {
  const r = await git
    .add('.')
    .commit(project.argv.message)
    .push(project.argv.remote, project.argv.branch)
  return !r.pushed.length
}, yargs()
  .option('message', { type: 'string', alias: 'm', default: '' })
  .option('remote', { type: 'string' })
  .option('branch', { type: 'string' })
  .build(), 'sequential')

registerSubcommand('chore', async (project, path, git) => {
  const s = await git.status()
  const files = s.files
    .filter(f => ['M', ' '].includes(f.working_dir) && f.path.split('/').reverse()[0] === 'package.json')
    .map(f => f.path)
  if (files.length) {
    await git.add(files).commit(project.argv.message || 'chore: bump versions')
    return true
  }
}, yargs().option('message', { type: 'string', alias: 'm', default: '' }).build(), 'sequential')

register('git', async (project) => {
  const subcommand = project.argv._.shift()
  if (!subcommand || !subcommands[subcommand]) {
    globalYargs.showHelp()
    return
  }
  const [action, options, policy] = subcommands[subcommand]

  project.argv.config = undefined
  project.argv = { config: options, ...parse(unparse(project.argv), options) }

  if (await project.serial('execute.trigger', 'git', options)) return
  await runAction(project, action, policy)
}, globalYargs.build<Options>({ manual: true }))
