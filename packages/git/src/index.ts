import { SimpleGit, simpleGit } from 'simple-git'
import { cyan, green, grey, red, yellow } from 'kleur'
import { Options, Project, register } from 'yakumo'
import { isAbsolute, join, relative, resolve } from 'path'
import {} from 'yakumo-core-patch'
import {} from 'yakumo-locate'

declare module 'yakumo' {
  interface Arguments {
    dry?: boolean
    root?: boolean
    rootOnly?: boolean
    workingDirectories?: string
    message: string
    remote?: string
    branch?: string
  }
}

function isSubdirectoryOf(dir: string, parent: string) {
  const relpath = relative(parent, dir)
  return relpath && !relpath.startsWith('..') && !isAbsolute(relpath)
}

async function isRepository(project: Project, name: string, git?: SimpleGit) {
  if (!name) return false
  git ??= simpleGit(name.slice(1))

  const gitDir = await git.raw('rev-parse', '--git-dir')
  if (gitDir.trim().startsWith('fatal:')) return false
  else if (gitDir.trim() === '.git') return project.argv.root || project.argv.rootOnly
  else return !project.argv.rootOnly
}

type Action = (project: Project, name: string, git: SimpleGit) => Promise<boolean>

const subcommands: Record<string, Action> = {}

const options: Options = {
  alias: {
    message: ['m'],
    workingDirectories: ['W'],
    root: ['r'],
    rootOnly: ['R'],
  },
  default: {
    message: '',
    locate: { root: true },
  },
  boolean: ['dry', 'root', 'rootOnly', 'verbose'],
}

async function runAction(project: Project, action: Action) {
  const counter = (await Promise.all(
    Object.keys(project.targets).map(async name => {
      if (!name) return false
      const git: SimpleGit = simpleGit(name.slice(1))
      try {
        if (!await isRepository(project, name, git)) return false
        return await action(project, name, git)
      } catch (e) {
        console.log(red(name), e)
        return false
      }
    }),
  )).filter(x => x).length
  console.log(green(`Successfully processed ${counter} repositories`))
}

function registerSubcommand(cmd: string, action: Action, options?: Options) {
  subcommands[cmd] = action
  register(`git/${cmd}`, (project) => runAction(project, action), options)
}

register('git', async (project) => {
  const subcommand = project.argv._.shift()
  const action = subcommands[subcommand]
  if (!subcommand || !action) return

  project.argv.config.manual = false
  await project.emit('execute.prepare', project, 'git')
  await project.emit('execute.before', project, 'git')

  await runAction(project, action)
}, { ...options, manual: true })

registerSubcommand('status', async (project, name, git) => {
  const packageRoot = resolve(process.cwd(), name.slice(1)),
    gitRoot = (await git.raw('rev-parse', '--git-dir')).trim().slice(0, -4) || packageRoot,
    relRoot = relative(gitRoot, packageRoot)

  const files = (await git.status()).files
    .filter(f => isSubdirectoryOf(f.path, relRoot) && (f.path = relative(relRoot, f.path)))
    .filter(f => !project.argv.workingDirectories || project.argv.workingDirectories.includes(f.working_dir))
    .map(f => `${(yellow(f.working_dir))} ${f.path} ${grey('=>')} ${(join(name.slice(1), f.path))}`)
  if (files.length) {
    console.log(cyan(name))
    console.log(files.join('\n'))
  }
  return true
}, options)

registerSubcommand('add', async (project, name, git) => {
  await git.add('.')
  return true
}, options)

registerSubcommand('commit', async (project, name, git) => {
  const res = await git.commit(project.argv.message)
  return !!res.commit
}, options)

registerSubcommand('push', async (project, name, git) => {
  if ((await git.status()).isClean()) {
    await git.push(project.argv.remote, project.argv.branch)
    return true
  }
}, options)

registerSubcommand('acp', async (project, name, git) => {
  const r = await git
    .add('.')
    .commit(project.argv.message)
    .push(project.argv.remote, project.argv.branch)
  return !!r.pushed.length
}, options)

registerSubcommand('chore', async (project, name, git) => {
  const s = await git.status()
  const files = s.files
    .filter(f => ['M', ' '].includes(f.working_dir) && f.path.split('/').reverse()[0] === 'package.json')
    .map(f => f.path)
  if (files.length) {
    await git.add(files).commit(project.argv.message || 'chore: bump versions')
    return true
  }
}, options)
