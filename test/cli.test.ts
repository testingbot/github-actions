import {describe, it, beforeEach, afterEach} from 'mocha'
import {strict as assert} from 'assert'
import * as sinon from 'sinon'
import * as core from '@actions/core'
import {mkdirSync, readFileSync, writeFileSync} from 'fs'
import {join} from 'path'
import {
    ExecLike,
    mergeJUnit,
    parseJUnit,
    renderCliSummary,
    runCli,
    splitArgs
} from '../src/lib/cli'
import {ESPRESSO_FLAGS} from '../src/espresso/index'
import {XCUITEST_FLAGS} from '../src/xcuitest/index'
import {githubEnv, resetEnv, setInputs, tempDir} from './helpers'

const SUITE = (name: string, failures: number): string =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${name}" tests="2" failures="${failures}"><testcase name="t"/></testsuite></testsuites>`

/** An exec stand-in that plays the CLI: writes the JSON file and reports. */
function fakeCli(
    outcome: string,
    calls: {cmd: string; args: string[]; env?: Record<string, string>}[],
    reports: string[] = [SUITE('run', 0)]
): ExecLike {
    return (async (
        cmd: string,
        args?: string[],
        opts?: {env?: Record<string, string>}
    ) => {
        const a = args ?? []
        calls.push({cmd, args: a, env: opts?.env})
        const reportDir = a[a.indexOf('--report-output-dir') + 1]
        reports.forEach((r, i) =>
            writeFileSync(join(reportDir, `report_${i}.xml`), r)
        )
        writeFileSync(
            a[a.indexOf('--json-file-name') + 1],
            JSON.stringify({
                provider: 'espresso',
                outcome,
                success: outcome === 'passed',
                appId: 321,
                url: 'https://testingbot.com/members/espresso/321',
                runs: [
                    {id: 1, status: 'DONE', passed: true},
                    {id: 2, status: 'DONE', passed: outcome === 'passed'}
                ]
            })
        )
        return 0
    }) as unknown as ExecLike
}

describe('testingbot CLI runner (espresso / xcuitest)', () => {
    let outputs: Record<string, string>
    let failed: sinon.SinonStub
    let dir: string

    beforeEach(() => {
        outputs = {}
        dir = tempDir()
        process.env['RUNNER_TEMP'] = dir
        sinon.stub(core, 'setOutput').callsFake((k, v) => {
            outputs[k] = String(v)
        })
        sinon.stub(core, 'info')
        sinon.stub(core, 'setSecret')
        sinon.stub(core, 'error')
        failed = sinon.stub(core, 'setFailed')
        setInputs({
            key: 'k',
            secret: 's',
            app: 'app.apk',
            'test-app': 'test.apk',
            'real-device': 'false',
            tunnel: 'false',
            retry: '0',
            'fail-fast': 'false',
            'tablet-only': 'false',
            'phone-only': 'false',
            async: 'false',
            'dry-run': 'false',
            'fail-on-failure': 'true',
            'cli-version': '1.5.0'
        })
    })

    afterEach(() => {
        sinon.restore()
        resetEnv()
    })

    it('builds the espresso command from inputs and passes credentials via env', async () => {
        githubEnv({pr: true})
        process.env['TB_BUILD'] = 'gh-build'
        setInputs({
            device: 'Pixel 8',
            'real-device': 'true',
            retry: '1',
            class: 'com.a.LoginTest,com.a.CartTest',
            metadata: 'team=mobile\nsuite=smoke',
            'extra-args': '--priority high --name "Overridden name"'
        })
        const calls: {
            cmd: string
            args: string[]
            env?: Record<string, string>
        }[] = []
        const result = await runCli({
            command: 'espresso',
            flags: ESPRESSO_FLAGS,
            exec: fakeCli('passed', calls)
        })
        assert.equal(result.outcome, 'passed')
        const {cmd, args, env} = calls[0]
        assert.equal(cmd, 'npx')
        assert.deepEqual(args.slice(0, 7), [
            '--yes',
            '@testingbot/cli@1.5.0',
            'espresso',
            '--app',
            'app.apk',
            '--test-app',
            'test.apk'
        ])
        const has = (...seq: string[]) =>
            args.some((_, i) => seq.every((s, j) => args[i + j] === s))
        assert.ok(has('--device', 'Pixel 8'))
        assert.ok(has('--real-device'))
        assert.ok(has('--retry', '1'))
        assert.ok(has('--class', 'com.a.LoginTest,com.a.CartTest'))
        assert.ok(has('--metadata', 'team=mobile', '--metadata', 'suite=smoke'))
        assert.ok(has('--name', 'Add checkout | flow'))
        assert.ok(has('--build', 'gh-build'))
        assert.ok(has('--commit-sha', 'abcdef1234567890'))
        assert.ok(has('--pull-request-id', '42'))
        assert.ok(has('--report', 'junit'))
        assert.ok(has('--json-file', '--json-file-name'))
        assert.ok(has('--priority', 'high', '--name', 'Overridden name'))
        assert.ok(
            !args.includes('k') && !args.includes('s'),
            'credentials stay off the command line'
        )
        assert.equal(env?.['TB_KEY'], 'k')
        assert.equal(env?.['TB_SECRET'], 's')
        assert.equal(outputs['outcome'], 'passed')
        assert.equal(outputs['app-id'], '321')
        assert.ok(failed.notCalled)
    })

    it('merges the JUnit reports and fails the step on test failures', async () => {
        githubEnv()
        const calls: {cmd: string; args: string[]}[] = []
        await runCli({
            command: 'xcuitest',
            flags: XCUITEST_FLAGS,
            exec: fakeCli('failed', calls, [
                SUITE('run-1', 0),
                SUITE('run-2', 1)
            ])
        })
        const junit = readFileSync(outputs['junit-file'], 'utf8')
        assert.equal(
            outputs['junit-file'],
            join(dir, 'testingbot-xcuitest-junit.xml')
        )
        assert.equal((junit.match(/<testsuite /g) || []).length, 2)
        assert.equal((junit.match(/<testsuites>/g) || []).length, 1)
        assert.ok(failed.calledOnce)
        assert.match(
            failed.firstCall.args[0],
            /1 of 2 TestingBot xcuitest runs failed/
        )
        assert.ok(
            calls[0].args.includes('--name'),
            'falls back to the commit message'
        )
        assert.ok(calls[0].args.includes('Fix login'))
    })

    it('only annotates failures with fail-on-failure: false', async () => {
        githubEnv()
        setInputs({'fail-on-failure': 'false'})
        await runCli({
            command: 'espresso',
            flags: ESPRESSO_FLAGS,
            exec: fakeCli('failed', [])
        })
        assert.ok(failed.notCalled)
        assert.ok((core.error as sinon.SinonStub).calledOnce)
    })

    it('throws on CLI errors and on a missing results file', async () => {
        githubEnv()
        await assert.rejects(
            runCli({
                command: 'espresso',
                flags: ESPRESSO_FLAGS,
                exec: fakeCli('error', [])
            }),
            /failed to start/
        )
        const silent = (async () => 1) as unknown as ExecLike
        await assert.rejects(
            runCli({command: 'espresso', flags: ESPRESSO_FLAGS, exec: silent}),
            /exited with code 1 without writing/
        )
    })

    it('uses TESTINGBOT_CLI_COMMAND for unpublished CLI builds', async () => {
        githubEnv()
        process.env['TESTINGBOT_CLI_COMMAND'] = 'node /opt/cli/dist/index.js'
        const calls: {cmd: string; args: string[]}[] = []
        await runCli({
            command: 'espresso',
            flags: ESPRESSO_FLAGS,
            exec: fakeCli('passed', calls)
        })
        assert.equal(calls[0].cmd, 'node')
        assert.deepEqual(calls[0].args.slice(0, 2), [
            '/opt/cli/dist/index.js',
            'espresso'
        ])
    })

    it('splits extra args and merges JUnit from a directory', () => {
        assert.deepEqual(splitArgs(`--a "b c" 'd e' f`), [
            '--a',
            'b c',
            'd e',
            'f'
        ])
        const d = join(tempDir(), 'r')
        assert.equal(mergeJUnit(d), undefined)
        mkdirSync(d)
        assert.equal(mergeJUnit(d), undefined)
        writeFileSync(join(d, 'a.xml'), SUITE('a', 0))
        assert.match(mergeJUnit(d) ?? '', /<testsuites>\n<testsuite name="a"/)
    })
})

describe('JUnit parsing and the CLI job summary', () => {
    const xml = readFileSync(
        join(__dirname, '../../test/fixtures/espresso-report.xml'),
        'utf8'
    )

    it('parses the TestingBot Espresso report', () => {
        const cases = parseJUnit(xml)
        assert.equal(cases.length, 6)
        const failed = cases.filter(c => c.failure !== undefined)
        assert.equal(failed.length, 1)
        assert.equal(
            failed[0].classname,
            'com.testingbot.calculator.AdvancedCalculatorTest'
        )
        assert.equal(failed[0].name, 'ensureLargeNumbersWork')
        assert.match(
            failed[0].failure ?? '',
            /^androidx\.test\.espresso.*doesn't match the selected view/
        )
        assert.ok(!(failed[0].failure ?? '').includes('&#'))
    })

    it('handles self-closing, error and skipped test cases', () => {
        const cases = parseJUnit(
            '<testsuite><testcase classname="A" name="ok" time="1.5"/>' +
                '<testcase classname="A" name="err"><error message="boom &amp; bust"/></testcase>' +
                '<testcase classname="A" name="skip"><skipped/></testcase></testsuite>'
        )
        assert.deepEqual(cases, [
            {classname: 'A', name: 'ok', time: 1.5},
            {classname: 'A', name: 'err', time: 0, failure: 'boom & bust'},
            {classname: 'A', name: 'skip', time: 0, skipped: true}
        ])
    })

    it('renders runs and failed tests', () => {
        const md = renderCliSummary(
            'espresso',
            {
                provider: 'espresso',
                outcome: 'failed',
                success: false,
                appId: 3438,
                runs: [
                    {
                        id: 3459,
                        status: 'DONE',
                        passed: false,
                        device: {name: '*', platform: 'Android'}
                    }
                ]
            },
            parseJUnit(xml),
            'https://testingbot.com/members/espresso/3438'
        )
        assert.match(md, /### ❌ TestingBot Espresso: failed/)
        assert.match(md, /\| ❌ \| Android \| #3459 \|/)
        assert.match(md, /\*\*5\*\* passed, \*\*1\*\* failed of 6 tests/)
        assert.match(
            md,
            /`com.testingbot.calculator.AdvancedCalculatorTest.ensureLargeNumbersWork`/
        )
    })
})
