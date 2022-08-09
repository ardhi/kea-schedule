const _ = require('lodash')
const luxon = require('luxon')
const { DateTime } = luxon
const path = require('path')
const schedule = require('node-schedule')
const fastGlob = require('fast-glob')

module.exports = function (options = {}) {
  const cwd = process.cwd().replace(/\\/g, '/')
  const jobDirPattern = options.jobDirPattern || `${cwd}/job/*.js`
  const entries = fastGlob.sync(jobDirPattern)
  const jobDefs = _.without(_.map(entries, f => {
    const mod = require(f)
    if (!(_.isFunction(mod) || _.isPlainObject(mod))) throw new Error(`Invalid job: ${f}`)
    const instance = _.isFunction(mod) ? mod() : mod
    instance.name = mod.name || path.basename(f, '.js')
    instance.runAt = null
    if (!instance.time) throw new Error(`Cron time is missing: ${f}`)
    if (!_.isFunction(instance.handler)) throw new Error(`Invalid function handler: ${f}`)
    return instance
  }), undefined, null)

  if (entries.length === 0) throw new Error(`No jobs available`)

  const jobs = _.map(jobDefs, j => {
    const job = schedule.scheduleJob(j.time, async () => {
      let text = `[${DateTime.local().toISO({ includeOffset: false })}][${j.name}] `
      if (j.runAt) {
        if (j.timeout) {
          const diff = Math.abs(DateTime.now().diff(j.runAt)) / 1000
          if (diff > j.timeout) {
            text += 'timeout, reset'
            j.runAt = null
          } else {
            text += 'still runAt, skipped'
          }
        } else {
          text += 'still runAt, skipped'
        }
      } else {
        const start = DateTime.now()
        j.runAt = start
        try {
          const result = await j.handler.call(j, ({ lib: { fastGlob, schedule, _, luxon } }))
          text += `Duration: ${DateTime.now().diff(start).toFormat('mm:ss')}, `
          text += `Result: ${_.isEmpty(result) ? 'success' : result }`
        } catch (err) {
          text += `Error: ${err.message}`
        }
        j.runAt = null
      }
      console.log(text)
    })
    return {
      name: j.name,
      instance: job
    }
  })

  console.log(`${jobs.length} job(s) running: ${_.map(jobs, 'name').join(', ')}`)
}
