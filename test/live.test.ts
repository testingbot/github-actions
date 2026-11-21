import {before, describe, it} from 'mocha'
import {strict as assert} from 'assert'
import {TestingBotApi} from '../src/lib/api'
import {count, fetchBuild, renderJUnit, renderMarkdown} from '../src/lib/report'

// npm run test:live, with TB_KEY / TB_SECRET (or TB_LIVE_BUILD) set.
// Talks to the real API; never runs in `npm test`.
describe('@live TestingBot API', function () {
    const key = process.env['TB_KEY']
    const secret = process.env['TB_SECRET']
    before(function () {
        if (!key || !secret) this.skip()
    })

    it('@live reports on a recent build', async () => {
        const api = new TestingBotApi({key: key!, secret: secret!})
        let build = process.env['TB_LIVE_BUILD']
        if (!build) {
            const page = await api.request<{
                data: {build_identifier: string}[]
            }>('GET', '/builds?offset=0&count=1')
            build = page.data[0].build_identifier
        }
        const tests = await fetchBuild(api, build, {
            timeoutSeconds: 0,
            pollSeconds: 0
        })
        assert.ok(tests.length > 0, `build ${build} has tests`)
        const md = renderMarkdown(tests, {
            build,
            buildId: await api.findBuildId(build),
            maxRows: 20
        })
        assert.match(md, /TestingBot/)
        assert.equal(
            (renderJUnit(tests, build).match(/<testcase /g) || []).length,
            count(tests).total
        )
    })

    it('@live uploads an app when TB_LIVE_APP is set', async function () {
        const file = process.env['TB_LIVE_APP']
        if (!file) this.skip()
        const api = new TestingBotApi({key: key!, secret: secret!})
        const {app_url} = await api.uploadFile(file!)
        assert.match(app_url, /^tb:\/\//)
        const app = await api.getStoredApp(app_url)
        assert.ok(app.id)
    })
})
