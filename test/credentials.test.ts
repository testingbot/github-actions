import {describe, it, afterEach} from 'mocha'
import {strict as assert} from 'assert'
import * as sinon from 'sinon'
import * as core from '@actions/core'
import {resolveCredentials} from '../src/lib/credentials'
import {resetEnv, setInputs} from './helpers'

describe('resolveCredentials', () => {
    afterEach(() => {
        sinon.restore()
        resetEnv()
    })

    it('prefers inputs, then TB_*, then TESTINGBOT_*, and masks them', () => {
        const mask = sinon.stub(core, 'setSecret')
        process.env['TESTINGBOT_KEY'] = 'k3'
        process.env['TESTINGBOT_SECRET'] = 's3'
        assert.deepEqual(resolveCredentials(), {key: 'k3', secret: 's3'})
        process.env['TB_KEY'] = 'k2'
        process.env['TB_SECRET'] = 's2'
        assert.deepEqual(resolveCredentials(), {key: 'k2', secret: 's2'})
        setInputs({key: 'k1', secret: 's1'})
        assert.deepEqual(resolveCredentials(), {key: 'k1', secret: 's1'})
        assert.ok(mask.calledWith('k1'))
        assert.ok(mask.calledWith('s1'))
    })

    it('throws a helpful error without credentials', () => {
        assert.throws(() => resolveCredentials(), /credentials are missing/)
    })
})
