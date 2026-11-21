import {describe, it, beforeEach, afterEach} from 'mocha'
import {strict as assert} from 'assert'
import * as sinon from 'sinon'
import * as core from '@actions/core'
import {readFileSync, writeFileSync} from 'fs'
import {join} from 'path'
import {TestingBotApi} from '../src/lib/api'
import {run} from '../src/report/index'
import {githubEnv, resetEnv, setInputs, tempDir} from './helpers'
import {fixture} from './report.test'

describe('report action', () => {
    let outputs: Record<string, string>
    let failed: sinon.SinonStub
    let dir: string

    beforeEach(() => {
        outputs = {}
        dir = tempDir()
        sinon.stub(core, 'setOutput').callsFake((k, v) => {
            outputs[k] = String(v)
        })
        sinon.stub(core, 'info')
        sinon.stub(core, 'warning')
        sinon.stub(core, 'setSecret')
        failed = sinon.stub(core, 'setFailed')
        sinon.stub(TestingBotApi.prototype, 'getBuildTests').resolves(fixture())
        sinon.stub(TestingBotApi.prototype, 'findBuildId').resolves(1234)
        writeFileSync(join(dir, 'summary.md'), '')
        process.env['GITHUB_STEP_SUMMARY'] = join(dir, 'summary.md')
        setInputs({
            key: 'k',
            secret: 's',
            'wait-timeout': '0',
            'comment-on-pr': 'false',
            'resolve-pr-check': 'false',
            'fail-on-failure': 'false',
            'github-token': 'ghs_x'
        })
    })

    afterEach(() => {
        sinon.restore()
        resetEnv()
    })

    it('writes the job summary, JUnit and outputs for $TB_BUILD', async () => {
        githubEnv()
        process.env['TB_BUILD'] = 'from-setup-env'
        setInputs({'junit-file': join(dir, 'out/junit.xml')})
        await run()
        assert.ok(
            (
                TestingBotApi.prototype.getBuildTests as sinon.SinonStub
            ).calledWith('from-setup-env')
        )
        const summary = readFileSync(join(dir, 'summary.md'), 'utf8')
        assert.match(summary, /tests failed/)
        assert.match(summary, /members\/builds\/1234/)
        assert.match(
            readFileSync(join(dir, 'out/junit.xml'), 'utf8'),
            /failures="1"/
        )
        assert.equal(outputs['outcome'], 'failed')
        assert.equal(outputs['failed'], '1')
        assert.equal(outputs['passed'], '5')
        assert.equal(
            outputs['build-url'],
            'https://testingbot.com/members/builds/1234'
        )
        assert.ok(failed.notCalled)
    })

    it('falls back to the setup-env default build name', async () => {
        githubEnv({pr: true})
        await run()
        assert.equal(
            outputs['build-name'],
            'github-storefront-pr-42-9876543210-2'
        )
    })

    it('fails the step with fail-on-failure', async () => {
        githubEnv()
        setInputs({'fail-on-failure': 'true'})
        await run()
        assert.ok(failed.calledOnceWith('1 TestingBot tests failed.'))
    })

    it('upserts a PR comment and resolves the PR check', async () => {
        githubEnv({pr: true})
        setInputs({'comment-on-pr': 'true', 'resolve-pr-check': 'true'})
        const resolveCi = sinon
            .stub(TestingBotApi.prototype, 'resolveCi')
            .resolves({})
        const calls: {url: string; init?: RequestInit}[] = []
        sinon.stub(globalThis, 'fetch').callsFake(async (url, init) => {
            calls.push({url: String(url), init})
            if (!init?.method) {
                return new Response(
                    JSON.stringify([
                        {id: 1, body: 'unrelated'},
                        {id: 2, body: '<!-- testingbot-report:CI -->\nold'}
                    ]),
                    {status: 200}
                )
            }
            return new Response('{}', {status: 200})
        })
        await run()
        assert.equal(
            calls[0].url,
            'https://api.github.com/repos/acme/storefront/issues/42/comments?per_page=100&page=1'
        )
        assert.equal(calls[1].init?.method, 'PATCH')
        assert.equal(
            calls[1].url,
            'https://api.github.com/repos/acme/storefront/issues/comments/2'
        )
        const body = JSON.parse(String(calls[1].init?.body)).body as string
        assert.ok(body.startsWith('<!-- testingbot-report:CI -->\n### ❌'))
        assert.ok(resolveCi.calledOnce)
    })

    it('creates the comment when none exists and never fails on comment errors', async () => {
        githubEnv({pr: true})
        setInputs({'comment-on-pr': 'true'})
        const fetchStub = sinon.stub(globalThis, 'fetch')
        fetchStub.onCall(0).resolves(new Response('[]', {status: 200}))
        fetchStub.onCall(1).resolves(new Response('forbidden', {status: 403}))
        await run()
        assert.equal(fetchStub.secondCall.args[1]?.method, 'POST')
        assert.ok((core.warning as sinon.SinonStub).calledOnce)
        assert.ok(failed.notCalled)
    })
})
