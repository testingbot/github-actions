import {describe, it, beforeEach, afterEach} from 'mocha'
import {strict as assert} from 'assert'
import * as sinon from 'sinon'
import * as core from '@actions/core'
import {writeFileSync, mkdirSync} from 'fs'
import {join} from 'path'
import {TestingBotApi} from '../src/lib/api'
import {readMetadata, run} from '../src/app-upload/index'
import {resetEnv, setInputs, tempDir} from './helpers'

describe('app-upload', () => {
    let outputs: Record<string, string>
    let exported: Record<string, string>
    let dir: string

    beforeEach(() => {
        outputs = {}
        exported = {}
        dir = tempDir()
        sinon.stub(core, 'setOutput').callsFake((k, v) => {
            outputs[k] = String(v)
        })
        sinon.stub(core, 'exportVariable').callsFake((k, v) => {
            exported[k] = String(v)
        })
        sinon.stub(core, 'info')
        sinon.stub(core, 'warning')
        sinon.stub(core, 'setSecret')
        setInputs({
            key: 'k',
            secret: 's',
            'wait-for-processing': 'true',
            'processing-timeout': '0'
        })
    })

    afterEach(() => {
        sinon.restore()
        resetEnv()
    })

    it('uploads a file and exposes the app URL and metadata', async () => {
        const file = join(dir, 'app.apk')
        writeFileSync(file, 'apk')
        setInputs({file, 'app-key': 'stable'})
        const upload = sinon
            .stub(TestingBotApi.prototype, 'uploadFile')
            .resolves({app_url: 'tb://stable'})
        sinon
            .stub(TestingBotApi.prototype, 'getStoredApp')
            .resolves({id: 9, state: 'DONE', version: '1.2.3'})
        await run()
        assert.ok(upload.calledOnceWith(file, 'stable'))
        assert.equal(outputs['app-url'], 'tb://stable')
        assert.equal(outputs['app-id'], '9')
        assert.equal(outputs['app-version'], '1.2.3')
        assert.equal(exported['TESTINGBOT_APP_URL'], 'tb://stable')
        assert.equal(exported['TB_APP_URL'], 'tb://stable')
    })

    it('uploads from a URL', async () => {
        setInputs({url: 'https://example.com/app.apk'})
        const upload = sinon
            .stub(TestingBotApi.prototype, 'uploadUrl')
            .resolves({app_url: 'tb://x'})
        sinon
            .stub(TestingBotApi.prototype, 'getStoredApp')
            .resolves({state: 'DONE'})
        await run()
        assert.ok(
            upload.calledOnceWith('https://example.com/app.apk', undefined)
        )
    })

    it('rejects a missing file, a directory, and both/neither inputs', async () => {
        setInputs({file: join(dir, 'missing.apk')})
        await assert.rejects(run(), /not found/)
        mkdirSync(join(dir, 'My.app'))
        setInputs({file: join(dir, 'My.app')})
        await assert.rejects(run(), /Zip a .app bundle/)
        setInputs({url: 'https://example.com/a.apk'})
        await assert.rejects(run(), /exactly one/)
        setInputs({file: '', url: ''})
        await assert.rejects(run(), /exactly one/)
    })

    it('polls while PROCESSING and never throws on metadata errors', async () => {
        const api = new TestingBotApi({key: 'k', secret: 's'})
        const get = sinon.stub(api, 'getStoredApp')
        get.onCall(0).resolves({state: 'PROCESSING'})
        get.onCall(1).resolves({state: 'DONE', version: '2'})
        assert.equal(
            (await readMetadata(api, 'tb://a', true, 5, 0))?.version,
            '2'
        )
        get.reset()
        get.rejects(new Error('boom'))
        assert.equal(await readMetadata(api, 'tb://a', true, 5, 0), undefined)
    })
})
