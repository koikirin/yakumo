import { CheckRepoActions, SimpleGit, simpleGit } from 'simple-git'
import { cyan, green, red, yellow } from 'kleur'
import { Project, register } from 'yakumo'
import { isAbsolute, relative, resolve } from 'path'
import {} from 'yakumo-core-patch'
import {} from 'yakumo-locate'

declare module 'yakumo' {
  interface Arguments {
    dry?: boolean
    root?: boolean
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

async function status(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(project.argv.root ? CheckRepoActions.IS_REPO_ROOT : CheckRepoActions.IN_TREE)) return false

    const packageRoot = resolve(process.cwd(), name.slice(1)),
      gitRoot = (await git.raw('rev-parse', '--git-dir')).trim().slice(0, -4) || packageRoot,
      relRoot = relative(gitRoot, packageRoot)

    const files = (await git.status()).files
      .filter(f => isSubdirectoryOf(f.path, relRoot) && (f.path = relative(relRoot, f.path)))
      .filter(f => !project.argv.workingDirectories || project.argv.workingDirectories.includes(f.working_dir))
      .map(f => `${(yellow(f.working_dir))} ${f.path}`)
    if (files.length) {
      console.log(cyan(name))
      console.log(files.join('\n'))
    }
    return true
  } catch (e) {
    console.log(red(name), e)
    return false
  }
}

async function add(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(project.argv.root ? CheckRepoActions.IS_REPO_ROOT : CheckRepoActions.IN_TREE)) return false

    await git.add('.')
    return true
  } catch (e) {
    console.log(red(name), e)
    return false
  }
}

async function commit(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(project.argv.root ? CheckRepoActions.IS_REPO_ROOT : CheckRepoActions.IN_TREE)) return false

    const res = await git.add('.').commit(project.argv.message)
    return !!res.commit
  } catch (e) {
    console.log(red(name), e)
    return false
  }
}

async function push(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(project.argv.root ? CheckRepoActions.IS_REPO_ROOT : CheckRepoActions.IN_TREE)) return false

    const s = await git.status()
    if (s.isClean()) await git.push(project.argv.remote, project.argv.branch)
    return true
  } catch (e) {
    console.log(red(name), e)
    return false
  }
}

async function chore(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(project.argv.root ? CheckRepoActions.IS_REPO_ROOT : CheckRepoActions.IN_TREE)) return false

    const s = await git.status()
    const files = s.files
      .filter(f => ['M', ' '].includes(f.working_dir) && f.path.split('/').reverse()[0] === 'package.json')
      .map(f => f.path)
    if (files.length) {
      await git.add(files).commit(project.argv.message || 'chore: bump versions')
      return true
    }
  } catch (e) {
    console.log(red(name), e)
    return false
  }
}

const subcommands: Record<string, (project: Project, name: string) => Promise<boolean>> = {
  status,
  add,
  commit,
  push,
  chore,
}

register('git', async (project) => {
  const subcommand = project.argv._.shift()
  const action = subcommands[subcommand]
  if (!subcommand || !action) return

  await project.emit('locate.trigger', project, 'git', { root: true })

  const counter = (await Promise.all(
    Object.keys(project.targets).map(name => action(project, name)),
  )).filter(x => x).length

  console.log(green(`Successfully processed ${counter} repositories`))
}, {
  alias: {
    dry: ['d'],
    message: ['m'],
    remote: ['r'],
    branch: ['b'],
    workingDirectories: ['W'],
    root: ['R'],
  },
  default: {
    message: '',
  },
  boolean: ['dry'],
  manual: true,
})
