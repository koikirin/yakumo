import { cyan, green } from 'kleur'
import { addHook, Project } from 'yakumo'
import { Awaitable, difference, makeArray, pick } from 'cosmokit'
import {} from 'yakumo-core-patch'

declare module 'yakumo' {
  export interface Hooks {
    'locate.trigger'?: (project: Project, name: string, options?: LocateOptions) => Awaitable<void>
  }

  export interface Commands {
    [key: string]: LocateConfig
  }

  export interface Arguments {
    locate: LocateConfig | false
  }
}

export interface LocateConfig {
  'exclude-patterns': string[]
}

export interface LocateOptions {
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
  const excludes = project.config.commands?.[name]?.['exclude-patterns']?.flatMap(name => locate(project, name, o)) || []
  const includes = (project.argv._.length ? project.argv._ : ['*']).flatMap((arg: string) => locate(project, arg, o))
  project.targets = pick(project.workspaces, difference(includes, excludes))

  console.log(cyan(`[${name}]`), green(`Located ${Object.keys(project.targets).length} workspaces`))
}

addHook('execute.prepare', () => true)

addHook('execute.before', (project, name) => {
  if (project.argv.config.manual) {
    project.targets = { ...project.workspaces }
    return
  }

  if (project.argv.locate === false && !project.targets?.length) {
    project.targets = pick(project.workspaces, project.argv._.flatMap((name: string) => {
      return project.locate(name)
    }))
    return
  }

  setTargets(project, name)
})

addHook('locate.trigger', setTargets)
