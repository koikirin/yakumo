import { Awaitable, pick, Promisify } from 'cosmokit'
import { commands, hooks, Options, Project } from 'yakumo'

declare module 'yakumo' {
  export interface Project {
    emit<T extends keyof Hooks>(name: T, ...args: Parameters<Hooks[T]>): Promise<void>
    serial<T extends keyof Hooks>(name: T, ...args: Parameters<Hooks[T]>): Promisify<ReturnType<Hooks[T]>>
  }

  export interface Hooks {
    'execute.targets': (project: Project, name: string) => Awaitable<true | void>
    'execute.prepare': (project: Project, name: string) => Awaitable<void>
    'execute.before': (project: Project, name: string) => Awaitable<true | ((project: Project) => void) | void>
  }
}

Project.prototype.serial = async (name: string, ...args: any) => {
  for (const callback of (hooks[name] || [])) {
    const result = await callback.call(this, ...args)
    if (result) return result
  }
}

function setTargets(project: Project) {
  if (!project.argv._.length || project.argv.config.manual) {
    project.targets = { ...project.workspaces }
    return
  }

  project.targets = pick(project.workspaces, project.argv._.flatMap((name: string) => {
    return project.locate(name)
  }))
}

export function register(name: string, callback: (project: Project) => void, options: Options = {}) {
  const manual = options.manual
  commands[name] = [async (project) => {
    project.argv.config.manual = manual
    if (!await project.serial('execute.targets', project, name)) {
      setTargets(project)
    }
    await project.serial('execute.prepare', project, name)
    const before = await project.serial('execute.before', project, name)
    if (before === true) return
    return (before || callback)(project)
  }, { ...options, manual: true }]
}

require('yakumo').register = register
