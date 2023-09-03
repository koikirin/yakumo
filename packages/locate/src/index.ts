import { bold, cyan, green, reset } from 'kleur'
import { addHook, confirm, Project } from 'yakumo'
import { Awaitable, difference, makeArray, pick } from 'cosmokit'
import {} from 'yakumo-core-patch'

declare module 'yakumo' {
  export interface Hooks {
    'locate.trigger'?: (this: Project, path: string, options?: LocateOptions) => Awaitable<void>
  }

  export interface Commands {
    [key: string]: LocateConfig
  }

  export interface Arguments {
    locate: LocateOptions | false
  }
}

export interface LocateConfig {
  'exclude-patterns': string[]
}

export interface LocateOptions {
  ask?: boolean
  root?: boolean
  folder?: boolean
  package?: boolean
}

const buildFnmatch = (glob) => {
  const matcher = glob
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const r = new RegExp(`^${matcher}$`)
  return r
}

function locateViaFolder(project: Project, name: string, options: LocateOptions = {}) {
  if (project.config.alias[name]) {
    return makeArray(project.config.alias[name]).map((path) => {
      if (!project.workspaces[path]) {
        throw new Error(`cannot find workspace ${path} resolved by ${name}`)
      }
      return path
    })
  }

  const targets = Object.keys(project.workspaces).filter((folder) => {
    const matcher = buildFnmatch(name)
    const json = project.workspaces[folder]
    if (!options.root && json.workspaces) return
    const [last] = folder.split('/').reverse()
    return name === last || matcher.test(folder) || matcher.test(folder && folder.slice(1))
  })
  return targets
}

function locateViaPackage(project: Project, name: string, options: LocateOptions = {}) {
  const matcher = buildFnmatch(name)
  const targets = Object.keys(project.workspaces).filter((folder) => {
    const json = project.workspaces[folder]
    if (!options.root && json.workspaces) return
    const [last] = json.name.split('/').reverse()
    return (name.startsWith('!') && name.slice(1) === json.name) || matcher.test(json.name) || matcher.test(last)
  })
  return targets
}

function locate(project: Project, name: string, options: LocateOptions = {}) {
  return [
    ...options.folder ? locateViaFolder(project, name, options) : [],
    ...options.package ? locateViaPackage(project, name, options) : [],
  ]
}

async function setTargets(project: Project, name: string, options: LocateOptions = {}) {
  const o = { root: false, folder: true, package: true, ...project.argv.locate || {}, ...options }
  const parent = name.split('/')[0]
  const excludes = (project.config.commands?.[name]?.['exclude-patterns'] ?? project.config.commands?.[parent]?.['exclude-patterns'])
    ?.flatMap(name => locate(project, name, o)) || []
  const includes = (project.argv._.length ? project.argv._ : ['*']).flatMap((arg: string) => locate(project, arg, o))
  project.targets = pick(project.workspaces, difference(includes, excludes))
}

addHook('execute.targets', () => true)

addHook('execute.prepare', async function (path) {
  if (this.argv.config.manual) {
    this.targets = { ...this.workspaces }
    return
  }

  if (this.argv.locate === false && !this.targets?.length) {
    this.targets = pick(this.workspaces, this.argv._.flatMap((name: string) => {
      return this.locate(name)
    }))
    return
  }

  setTargets(this, path)
})

addHook('execute.before', async function (path) {
  if (this.argv.config.manual || this.argv.locate === false) {
    return
  }
  if (this.argv.locate?.ask) {
    const confirmed = await confirm(
      `${cyan(`[${path}]`)} ${green(`Located ${Object.keys(this.targets).length} workspaces:`)}
  ${reset(Object.values(this.targets).map(json => json.name).join(' '))}
  ${bold('Continue to execute ?')}`)
    if (!confirmed) return true
  } else {
    console.log(cyan(`[${path}]`), green(`Located ${Object.keys(this.targets).length} workspaces.`))
  }
})

addHook('locate.trigger', async function (path) { setTargets(this, path) })
