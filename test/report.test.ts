import {describe, it} from 'mocha'
import {strict as assert} from 'assert'
import {readFileSync} from 'fs'
import {join} from 'path'
import {TestingBotApi, TestingBotTest} from '../src/lib/api'
import {
    classify,
    count,
    environment,
    fetchBuild,
    outcomeOf,
    renderJUnit,
    renderMarkdown
} from '../src/lib/report'
import {fakeFetch} from './helpers'

export const fixture = (): TestingBotTest[] =>
    JSON.parse(
        readFileSync(join(__dirname, '../../test/fixtures/build.json'), 'utf8')
    ).data

describe('report', () => {
    it('classifies tests', () => {
        const base = fixture()[0]
        assert.equal(classify({...base, success: true}), 'passed')
        assert.equal(classify({...base, success: false}), 'failed')
        assert.equal(classify({...base, success: null}), 'unknown')
        assert.equal(
            classify({...base, success: false, unknown: true}),
            'unknown'
        )
        assert.equal(classify({...base, state: 'RUNNING'}), 'running')
    })

    it('counts and derives the outcome', () => {
        const counts = count(fixture())
        assert.deepEqual(counts, {
            total: 6,
            passed: 5,
            failed: 1,
            unknown: 0,
            running: 0
        })
        assert.equal(outcomeOf(counts), 'failed')
        assert.equal(outcomeOf(count([])), 'no-tests')
    })

    it('labels environments for devices and desktops', () => {
        const t = fixture()[0]
        assert.equal(environment(t), 'Chrome | Pixel - 7.1')
        assert.equal(
            environment({
                ...t,
                browser_display_name: 'Chrome 157',
                os: 'WIN10'
            }),
            'Chrome 157 · WIN10'
        )
    })

    it('renders markdown with failed tests first and escaped cells', () => {
        const tests = fixture()
        tests[5].status_message = 'expected 4 | got 5'
        const md = renderMarkdown(tests, {
            build: 'b-1',
            buildId: 99,
            maxRows: 3
        })
        assert.match(md, /❌ TestingBot: tests failed/)
        assert.match(
            md,
            /\[`b-1`\]\(https:\/\/testingbot.com\/members\/builds\/99\)/
        )
        assert.match(md, /\*\*5\*\* passed, \*\*1\*\* failed of 6 tests/)
        const rows = md
            .split('\n')
            .filter(l => l.startsWith('| ✅') || l.startsWith('| ❌'))
        assert.equal(rows.length, 3)
        assert.ok(
            rows[0].startsWith(
                '| ❌ | Calculator matrix<br><sub>expected 4 \\| got 5'
            )
        )
        assert.match(
            rows[0],
            /\[Session\]\(https:\/\/testingbot.com\/members\/tests\/session-5\)/
        )
        assert.match(md, /3 more tests on/)
    })

    it('says so when the build has no tests', () => {
        assert.match(renderMarkdown([], {build: 'b', maxRows: 10}), /no tests/)
    })

    it('renders JUnit with failures and escaping', () => {
        const tests = fixture()
        tests[0].name = 'a <b> & "c"'
        tests[1].success = null
        const xml = renderJUnit(tests, 'b&1')
        assert.match(
            xml,
            /<testsuite name="b&amp;1" tests="6" failures="1" skipped="1"/
        )
        assert.match(xml, /name="a &lt;b&gt; &amp; &quot;c&quot;"/)
        assert.equal((xml.match(/<failure /g) || []).length, 1)
        assert.equal((xml.match(/<skipped /g) || []).length, 1)
    })

    it('waits while the build is missing or running', async () => {
        const running = fixture().map(t => ({...t, state: 'RUNNING'}))
        const done = fixture()
        const api = new TestingBotApi(
            {key: 'k', secret: 's'},
            'https://api.test/v1',
            fakeFetch([
                [404, {error: 'Could not find build'}],
                [200, {data: running, meta: {total: 6}}],
                [200, {data: done, meta: {total: 6}}]
            ]),
            0
        )
        const logs: string[] = []
        const tests = await fetchBuild(api, 'b', {
            timeoutSeconds: 5,
            pollSeconds: 0,
            log: m => logs.push(m)
        })
        assert.equal(tests.length, 6)
        assert.equal(logs.length, 2)
        assert.match(logs[0], /no tests yet/)
        assert.match(logs[1], /6 of 6 tests still running/)
    })

    it('returns what it has at the deadline', async () => {
        const api = new TestingBotApi(
            {key: 'k', secret: 's'},
            'https://api.test/v1',
            fakeFetch([[404, {}]]),
            0
        )
        const tests = await fetchBuild(api, 'b', {
            timeoutSeconds: 0,
            pollSeconds: 0
        })
        assert.deepEqual(tests, [])
    })
})
