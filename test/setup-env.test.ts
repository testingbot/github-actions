import {describe, it, beforeEach, afterEach} from 'mocha'
import {strict as assert} from 'assert'
import * as sinon from 'sinon'
import * as core from '@actions/core'
import {TestingBotApi} from '../src/lib/api'
import {run} from '../src/setup-env/index'
import {githubEnv, resetEnv, setInputs} from './helpers'

describe('setup-env', () => {
    let exported: Record<string, string>
    let outputs: Record<string, string>

    beforeEach(() => {
        exported = {}
        outputs = {}
        sinon.stub(core, 'exportVariable').callsFake((k, v) => {
            exported[k] = String(v)
        })
        sinon.stub(core, 'setOutput').callsFake((k, v) => {
            outputs[k] = String(v)
        })
        sinon.stub(core, 'info')
        sinon.stub(core, 'warning')
        sinon.stub(core, 'setSecret')
        setInputs({
            key: 'k',
            secret: 's',
            'export-credentials': 'true',
            'pr-check': 'false'
        })
    })

    afterEach(() => {
        sinon.restore()
        resetEnv()
    })

    it('exports credentials, build and tunnel identifier under both names', async () => {
        githubEnv()
        await run()
        assert.equal(exported['TB_KEY'], 'k')
        assert.equal(exported['TESTINGBOT_KEY'], 'k')
        assert.equal(exported['TB_SECRET'], 's')
        assert.equal(exported['TESTINGBOT_SECRET'], 's')
        assert.equal(
            exported['TB_BUILD'],
            'github-storefront-main-9876543210-2'
        )
        assert.equal(exported['TESTINGBOT_BUILD'], exported['TB_BUILD'])
        assert.match(
            exported['TB_TUNNEL_IDENTIFIER'],
            /^github-9876543210-2-e2e-[0-9a-f]{6}$/
        )
        assert.equal(
            exported['TESTINGBOT_TUNNEL_IDENTIFIER'],
            exported['TB_TUNNEL_IDENTIFIER']
        )
        assert.equal(outputs['build-name'], exported['TB_BUILD'])
    })

    it('honours build-name templates, a fixed tunnel id and export-credentials: false', async () => {
        githubEnv({pr: true})
        setInputs({
            'build-name': '{repo} PR {pr} run {run_number}',
            'tunnel-identifier': 'my-tunnel',
            'export-credentials': 'false'
        })
        await run()
        assert.equal(exported['TB_BUILD'], 'storefront PR 42 run 77')
        assert.equal(exported['TB_TUNNEL_IDENTIFIER'], 'my-tunnel')
        assert.equal(exported['TB_KEY'], undefined)
    })

    it('registers the PR check with the head SHA', async () => {
        githubEnv({pr: true})
        setInputs({'pr-check': 'true'})
        const register = sinon
            .stub(TestingBotApi.prototype, 'registerCi')
            .resolves({})
        await run()
        assert.ok(
            register.calledOnceWith('github-storefront-pr-42-9876543210-2', {
                repo: 'acme/storefront',
                commitSha: 'abcdef1234567890',
                pullRequestNumber: '42'
            })
        )
    })

    it('only warns when registering the PR check fails', async () => {
        githubEnv({pr: true})
        setInputs({'pr-check': 'true'})
        sinon
            .stub(TestingBotApi.prototype, 'registerCi')
            .rejects(new Error('nope'))
        await run()
        assert.ok((core.warning as sinon.SinonStub).calledOnce)
    })
})
