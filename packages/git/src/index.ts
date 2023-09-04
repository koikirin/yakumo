import { SimpleGit, simpleGit } from 'simple-git'
import { cyan, green, grey, red, yellow } from 'kleur'
import { Options, Project, register } from 'yakumo'
import { isAbsolute, join, relative, resolve } from 'path'
import parse from 'yargs-parser'
import unparse from 'yargs-unparser'
import { yargs as yargs_ } from 'yakumo-core-patch'
import {} from 'yakumo-locate'

function isSubdirectoryOf(dir: string, parent: string) {
  const relpath = relative(parent, dir)
  return relpath && !relpath.startsWith('..') && !isAbsolute(relpath)
}

async function isRepository(project: Project, name: string, git?: SimpleGit) {
  if (!name || !project.targets[name]) return false
  git ??= simpleGit(name.slice(1))

  const gitDir = await git.raw('rev-parse', '--git-dir')
  if (gitDir.trim().startsWith('fatal:')) return false
  else if (gitDir.trim() === '.git') return !project.targets[name].workspaces || project.argv.root || project.argv.rootOnly
  else return !project.argv.rootOnly
}

type Action = (project: Project, name: string, git: SimpleGit) => Promise<boolean>

const subcommands: Record<string, [Action, Options]> = {}

function yargs() {
  return yargs_()
    .option('root', { type: 'boolean', alias: 'r' })
    .option('rootOnly', { type: 'boolean', alias: 'R' })
    .option('dry', { type: 'boolean' })
    .default('locate.root', true)
}

async function runAction(project: Project, action: Action) {
  const counter = (await Promise.all(
    Object.keys(project.targets).map(async path => {
      if (!path) return false
      const git: SimpleGit = simpleGit(path.slice(1))
      try {
        if (!await isRepository(project, path, git)) return false
        return await action(project, path, git)
      } catch (e) {
        console.log(red(path), e)
        return false
      }
    }),
  )).filter(x => x).length
  console.log(green(`Successfully processed ${counter} repositories`))
}

function registerSubcommand(cmd: string, action: Action, options?: Options) {
  subcommands[cmd] = [action, options]
  register(`git/${cmd}`, (project) => runAction(project, action), options)
}

register('git', async (project) => {
  const subcommand = project.argv._.shift()
  if (!subcommand || !subcommands[subcommand]) return
  const [action, options] = subcommands[subcommand]

  project.argv.config = undefined
  project.argv = { config: options, ...parse(unparse(project.argv), options) }

  if (await project.serial('execute.trigger', 'git', options)) return
  await runAction(project, action)
}, { manual: true })

registerSubcommand('status', async (project, path, git) => {
  const packageRoot = resolve(process.cwd(), path.slice(1)),
    gitRoot = (await git.raw('rev-parse', '--git-dir')).trim().slice(0, -4) || packageRoot,
    relRoot = relative(gitRoot, packageRoot)

  const files = (await git.status()).files
    .filter(f => isSubdirectoryOf(f.path, relRoot) && (f.path = relative(relRoot, f.path)))
    .filter(f => !project.argv.workingDirectories || project.argv.workingDirectories.includes(f.working_dir))
    .map(f => `${(yellow(f.working_dir))} ${f.path} ${grey('->')} ${(join(path.slice(1), f.path))}`)
  if (files.length) {
    console.log(cyan(path))
    console.log(files.join('\n'))
  }
  return true
}, yargs().option('workingDirectories', { type: 'string', alias: 'W' }).build())

registerSubcommand('add', async (project, path, git) => {
  await git.add('.')
  return true
}, yargs().build())

registerSubcommand('commit', async (project, path, git) => {
  const res = await git.commit(project.argv.message)
  return !!res.commit
}, yargs().option('message', { type: 'string', alias: 'm', default: '' }).build())

registerSubcommand('push', async (project, path, git) => {
  if ((await git.status()).isClean()) {
    await git.push(project.argv.remote, project.argv.branch)
    return true
  }
}, yargs().option('remote', { type: 'string' }).option('branch', { type: 'string' }).build())

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
  .build())

registerSubcommand('chore', async (project, path, git) => {
  const s = await git.status()
  const files = s.files
    .filter(f => ['M', ' '].includes(f.working_dir) && f.path.split('/').reverse()[0] === 'package.json')
    .map(f => f.path)
  if (files.length) {
    await git.add(files).commit(project.argv.message || 'chore: bump versions')
    return true
  }
}, yargs().option('message', { type: 'string', alias: 'm', default: '' }).build())
