import { Awaitable, pick, Promisify } from 'cosmokit'
import { addHook, commands, hooks, Options, Project } from 'yakumo'
import { Options as ParserOptions } from 'yargs-parser'
import * as yargs_ from 'yargs'

declare module 'yakumo' {
  export interface Project {
    emit<T extends keyof Hooks>(name: T, ...args: Parameters<Hooks[T]>): Promise<void>
    serial<T extends keyof Hooks>(name: T, ...args: Parameters<Hooks[T]>): Promisify<ReturnType<Hooks[T]>>
  }

  export interface Hooks {
    'execute.targets': (this: Project, name: string) => Awaitable<boolean | void>
    'execute.prepare': (this: Project, name: string) => Awaitable<void>
    'execute.before': (this: Project, name: string) => Awaitable<boolean | ((project: Project) => void) | void>
    'execute.trigger': (this: Project, name: string, options: Options) => Awaitable<boolean | void>
  }

  export interface Options {
    argv?: yargs_.Argv
  }
}

declare module 'yargs' {
  interface Argv {
    getOptions(): ParserOptions
    build(): ParserOptions
  }
}

Project.prototype.serial = async function (this: Project, name: string, ...args: any) {
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

async function beforeExecute(project: Project, name: string, options: Options = {}) {
  if (options.argv && project.argv.help) {
    options.argv.showHelp()
    return true
  }

  if (options.argv && project.argv.version) {
    options.argv.showVersion()
    return true
  }

  if (!await project.serial('execute.targets', name)) {
    setTargets(project)
  }
  await project.serial('execute.prepare', name)
  return await project.serial('execute.before', name)
}

export function register(name: string, callback: (project: Project) => void, options: Options = {}) {
  const manual = options.manual
  commands[name] = [async (project) => {
    project.argv.config.manual = manual
    const before = await beforeExecute(project, name, options)
    if (before === true) return
    return (before || callback)(project)
  }, { ...options, manual: true }]
}

require('yakumo').register = register

addHook('execute.trigger', async function (name: string, options: Options) {
  return !!await beforeExecute(this, name, options)
})

export function yargs() {
  const argv = yargs_.default()
  argv.build = () => ({ argv, ...argv.getOptions() })
  return argv
}

export function declareYargs(name: string, argv: yargs_.Argv) {
  if (commands[name]) {
    if (commands[name][1]) {
      commands[name][1].argv ||= argv
    } else {
      commands[name][1] = { argv }
    }
  } else {
    commands[name] = [null, { argv }]
  }
}
