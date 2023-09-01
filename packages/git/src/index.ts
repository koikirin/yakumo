import { CheckRepoActions, SimpleGit, simpleGit } from 'simple-git'
import { cyan, green, red, yellow } from 'kleur'
import { Project, register } from 'yakumo'
import {} from 'yakumo-core-patch'
import {} from 'yakumo-locate'

async function status(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
    ) return false
    const s = await git.status()
    console.log(cyan(name), s.files.map(f => `${yellow(f.working_dir)} ${f.path}`).join('\t'))
  } catch (e) {
    console.log(red(name), e)
    return false
  }
  return true
}

async function commit(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
    ) return false
    console.log(await git.add('.').commit(project.argv.message))
  } catch (e) {
    console.log(red(name), e)
    return false
  }
  return true
}

async function push(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
    ) return false
    const s = await git.status()
    if (s.isClean()) await git.push(project.argv.remote, project.argv.branch)
  } catch (e) {
    console.log(red(name), e)
    return false
  }
  return true
}

async function choreBumpVersions(project: Project, name: string) {
  try {
    if (!name) return false
    const git: SimpleGit = simpleGit(name.slice(1))
    if (!await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
    ) return false
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
  commit,
  push,
  chore: choreBumpVersions,
}

register('git', async (project) => {
  const subcommand = project.argv._.shift()
  const action = subcommands[subcommand]
  if (!subcommand || !action) return

  await project.emit('locate.trigger', project, 'git', { root: true })

  const counter = (await Promise.all(
    Object.keys(project.targets).map(name => action(project, name)),
  )).filter(x => x).length

  console.log(green(`Successfully updated ${counter} repositories`))
}, {
  alias: {
    dry: ['d'],
    message: ['m'],
    remote: ['r'],
    branch: ['b'],
  },
  default: {
    message: '',
  },
  boolean: ['dry'],
  manual: true,
})
