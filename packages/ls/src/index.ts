import { cyan, green } from 'kleur'
import { register } from 'yakumo'

register('ls', async (project) => {
  for (const [name, json] of Object.entries(project.targets)) {
    console.log(`${green(json.name)} -> ${cyan(name)}`)
  }
})
