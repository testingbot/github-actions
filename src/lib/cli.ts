import {
    error as annotateError,
    getBooleanInput,
    getInput,
    info,
    setFailed,
    setOutput,
    summary
} from '@actions/core'
import {exec} from '@actions/exec'
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'fs'
import {join, resolve} from 'path'
import {resolveCredentials} from './credentials'
import {checkSha, runContext} from './github'

/**
 * How an action input becomes a `testingbot <command>` flag.
 * - value: `--flag <input>` when set
 * - switch: `--flag` when the input is true
 * - lines: `--flag <line>` for every non-empty line (repeatable flags)
 */
export interface FlagSpec {
    input: string
    flag: string
    kind: 'value' | 'switch' | 'lines'
}

/** Flags shared by `testingbot espresso` and `testingbot xcuitest`. */
export const COMMON_FLAGS: FlagSpec[] = [
    {input: 'device', flag: '--device', kind: 'value'},
    {input: 'platform-version', flag: '--platform-version', kind: 'value'},
    {input: 'real-device', flag: '--real-device', kind: 'switch'},
    {input: 'tablet-only', flag: '--tablet-only', kind: 'switch'},
    {input: 'phone-only', flag: '--phone-only', kind: 'switch'},
    {input: 'locale', flag: '--locale', kind: 'value'},
    {input: 'timezone', flag: '--timezone', kind: 'value'},
    {input: 'language', flag: '--language', kind: 'value'},
    {input: 'geo-country-code', flag: '--geo-country-code', kind: 'value'},
    {input: 'throttle-network', flag: '--throttle-network', kind: 'value'},
    {input: 'tunnel', flag: '--tunnel', kind: 'switch'},
    {input: 'tunnel-identifier', flag: '--tunnel-identifier', kind: 'value'},
    {input: 'retry', flag: '--retry', kind: 'value'},
    {input: 'timeout', flag: '--timeout', kind: 'value'},
    {input: 'fail-fast', flag: '--fail-fast', kind: 'switch'},
    {input: 'priority', flag: '--priority', kind: 'value'},
    {input: 'metadata', flag: '--metadata', kind: 'lines'},
    {input: 'async', flag: '--async', kind: 'switch'},
    {input: 'dry-run', flag: '--dry-run', kind: 'switch'}
]

export function lines(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
}

function isTrue(name: string): boolean {
    try {
        return getBooleanInput(name)
    } catch {
        return false
    }
}

export function flagsFromInputs(specs: FlagSpec[]): string[] {
    const args: string[] = []
    for (const spec of specs) {
        const value = getInput(spec.input)
        if (spec.kind === 'switch') {
            if (isTrue(spec.input)) args.push(spec.flag)
        } else if (spec.kind === 'lines') {
            for (const line of lines(value)) args.push(spec.flag, line)
        } else if (value !== '') {
            // `retry: 0` is the CLI default; leave it out.
            if (spec.input === 'retry' && value === '0') continue
            args.push(spec.flag, value)
        }
    }
    return args
}

/** Split extra-args on whitespace, keeping "quoted strings" together. */
export function splitArgs(text: string): string[] {
    const out: string[] = []
    for (const m of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
        out.push(m[1] ?? m[2] ?? m[3])
    }
    return out
}

export interface JsonRun {
    id: number
    status: string
    passed: boolean
    device?: {name?: string; platform?: string; version?: string}
    url?: string
}

export interface JsonOutput {
    provider: string
    outcome: 'passed' | 'failed' | 'started' | 'running' | 'dry-run' | 'error'
    success: boolean
    appId?: number
    url?: string
    error?: string
    runs: JsonRun[]
}

/**
 * Merges the CLI's JUnit reports (Espresso writes one per project, XCUITest
 * one per run) into a single <testsuites> document.
 */
export function mergeJUnit(dir: string): string | undefined {
    if (!existsSync(dir)) return undefined
    const files = readdirSync(dir)
        .filter(f => f.endsWith('.xml'))
        .sort()
    if (files.length === 0) return undefined
    const suites = files.map(f =>
        readFileSync(join(dir, f), 'utf8')
            .replace(/^\s*<\?xml[^>]*\?>\s*/, '')
            .replace(/<\/?testsuites\b[^>]*>/g, '')
            .trim()
    )
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`
}

export type ExecLike = typeof exec

export interface RunOptions {
    command: 'espresso' | 'xcuitest'
    flags: FlagSpec[]
    exec?: ExecLike
}

/**
 * Runs `npx @testingbot/cli <command>` with the action's inputs, waits for
 * the result (unless async), writes a merged JUnit file, sets outputs and
 * fails the step when tests fail. The CLI uploads both apps, polls the run
 * and writes the job summary and failure annotations itself.
 */
export async function runCli(options: RunOptions): Promise<JsonOutput> {
    const credentials = resolveCredentials()
    const ctx = runContext()
    const tmp = process.env['RUNNER_TEMP'] || process.cwd()
    const resultsFile = join(tmp, `testingbot-${options.command}-results.json`)
    const reportDir = resolve(
        getInput('report-output-dir') ||
            join(tmp, `testingbot-${options.command}-reports`)
    )
    // A second run in the same job must not pick up the first run's files.
    rmSync(resultsFile, {force: true})
    if (!getInput('report-output-dir')) {
        rmSync(reportDir, {recursive: true, force: true})
    }
    mkdirSync(reportDir, {recursive: true})

    const app = getInput('app', {required: true})
    const testApp = getInput('test-app', {required: true})
    const args = [options.command, '--app', app, '--test-app', testApp]
    args.push(...flagsFromInputs(options.flags))

    const name =
        getInput('name') ||
        ctx.pr?.title ||
        (ctx.commitMessage || '').split('\n')[0]
    if (name) args.push('--name', name)
    const build =
        getInput('build') ||
        process.env['TB_BUILD'] ||
        process.env['TESTINGBOT_BUILD']
    if (build) args.push('--build', build)

    // The CLI detects the repository, branch and PR from the GitHub env; the
    // PR head SHA is passed explicitly so a PR check lands on the head commit.
    const sha = checkSha(ctx)
    if (sha) args.push('--commit-sha', sha)
    if (ctx.pr) {
        args.push('--pull-request-id', String(ctx.pr.number))
        args.push('--branch', ctx.pr.headRef)
    }

    const downloadArtifacts = getInput('download-artifacts')
    if (downloadArtifacts) {
        args.push('--download-artifacts', downloadArtifacts)
        args.push(
            '--artifacts-output-dir',
            getInput('artifacts-output-dir') ||
                join(tmp, 'testingbot-artifacts')
        )
    }
    args.push('--report', 'junit', '--report-output-dir', reportDir)
    args.push('--json-file', '--json-file-name', resultsFile)
    args.push(...splitArgs(getInput('extra-args')))

    const cliCommand = process.env['TESTINGBOT_CLI_COMMAND']
    const cli = cliCommand
        ? splitArgs(cliCommand)
        : [
              'npx',
              '--yes',
              `@testingbot/cli@${getInput('cli-version') || 'latest'}`
          ]

    info(`testingbot ${args.join(' ')}`)
    const exitCode = await (options.exec ?? exec)(
        cli[0],
        [...cli.slice(1), ...args],
        {
            ignoreReturnCode: true,
            env: {
                ...(process.env as Record<string, string>),
                TB_KEY: credentials.key,
                TB_SECRET: credentials.secret,
                TESTINGBOT_NO_UPDATE_CHECK: '1',
                // This action writes a per-test summary and annotations from
                // the JUnit report; the CLI's run-level table would repeat it.
                TESTINGBOT_CI_SUMMARY: '0'
            }
        }
    )

    if (!existsSync(resultsFile)) {
        throw new Error(
            `The TestingBot CLI exited with code ${exitCode} without writing ${resultsFile}.`
        )
    }
    const result = JSON.parse(readFileSync(resultsFile, 'utf8')) as JsonOutput
    const consoleUrl =
        result.url ||
        (result.appId
            ? `https://testingbot.com/members/${options.command}/${result.appId}`
            : '')
    const runs = (result.runs ?? []).map(r => ({
        id: r.id,
        status: r.status,
        passed: r.passed,
        device: r.device,
        url: r.url
    }))
    setOutput('outcome', result.outcome)
    setOutput('results-file', resultsFile)
    setOutput('console-url', consoleUrl)
    setOutput('app-id', result.appId !== undefined ? String(result.appId) : '')
    setOutput('runs', JSON.stringify(runs))

    const junit = mergeJUnit(reportDir)
    const cases = junit ? parseJUnit(junit) : []
    if (junit) {
        const junitFile = resolve(
            getInput('junit-file') ||
                join(tmp, `testingbot-${options.command}-junit.xml`)
        )
        writeFileSync(junitFile, junit)
        setOutput('junit-file', junitFile)
        info(`JUnit report: ${junitFile}`)
    }
    const failedCases = cases.filter(c => c.failure !== undefined)
    for (const c of failedCases.slice(0, 10)) {
        annotateError(c.failure || 'failed', {
            title: `TestingBot: ${c.classname}.${c.name}`
        })
    }
    if (process.env['GITHUB_STEP_SUMMARY']) {
        await summary
            .addRaw(
                renderCliSummary(options.command, result, cases, consoleUrl),
                true
            )
            .write()
    }

    if (result.outcome === 'error') {
        throw new Error(result.error || 'The TestingBot run failed to start.')
    }
    if (result.outcome === 'failed') {
        const failed = runs.filter(r => !r.passed).length
        const tests = failedCases.length
            ? ` (${failedCases.length} of ${cases.length} tests)`
            : ''
        const message =
            `${failed} of ${runs.length} TestingBot ${options.command} runs failed${tests}. ${consoleUrl}`.trim()
        if (getInput('fail-on-failure') !== 'false') {
            setFailed(message)
        } else {
            annotateError(message)
        }
    }
    return result
}

export interface TestCase {
    classname: string
    name: string
    time: number
    /** First line of the failure/error message; undefined when it passed. */
    failure?: string
    skipped?: boolean
}

function unescapeXml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
            String.fromCodePoint(parseInt(h, 16))
        )
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
        .replace(/\r/g, '')
        .replace(/&amp;/g, '&')
}

function attr(tag: string, name: string): string {
    const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
    return m ? unescapeXml(m[1]) : ''
}

/** The test cases of a JUnit document (Espresso and XCUITest reports). */
export function parseJUnit(xml: string): TestCase[] {
    const cases: TestCase[] = []
    const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g
    for (const m of xml.matchAll(re)) {
        const open = m[1]
        const body = m[3] ?? ''
        const name = attr(open, 'name')
        // TestingBot's project-level Espresso report repeats the method in
        // the classname (com.a.LoginTest.testLogin); keep just the class.
        let classname = attr(open, 'classname')
        if (name && classname.endsWith(`.${name}`)) {
            classname = classname.slice(0, -name.length - 1)
        }
        const c: TestCase = {
            classname,
            name,
            time: Number(attr(open, 'time')) || 0
        }
        const fail = body.match(
            /<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/
        )
        if (fail) {
            const text = attr(fail[2], 'message') || ''
            const detail = unescapeXml(fail[4] ?? '')
                .trim()
                .split('\n')[0]
            c.failure =
                (text && text !== 'Test failed' ? text : detail || text).slice(
                    0,
                    300
                ) || 'failed'
        } else if (/<skipped\b/.test(body)) {
            c.skipped = true
        }
        cases.push(c)
    }
    return cases
}

function mdCell(text: string): string {
    return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}

export function renderCliSummary(
    command: string,
    result: JsonOutput,
    cases: TestCase[],
    consoleUrl: string
): string {
    const label = command === 'xcuitest' ? 'XCUITest' : 'Espresso'
    const icon: Record<string, string> = {
        passed: '✅',
        failed: '❌',
        started: '🚀',
        'dry-run': '🧪',
        error: '⚠️'
    }
    let md = `### ${icon[result.outcome] ?? '❔'} TestingBot ${label}: ${result.outcome}\n\n`
    if (consoleUrl) md += `[Open in TestingBot](${consoleUrl})\n\n`
    if (result.error) md += `> ${mdCell(result.error)}\n\n`
    if (result.runs?.length) {
        md += '| | Device | Run |\n|---|---|---|\n'
        for (const r of result.runs) {
            const device =
                [r.device?.name, r.device?.version]
                    .filter(v => v && v !== '*')
                    .join(' ') ||
                r.device?.platform ||
                'any'
            const run = r.url ? `[#${r.id}](${r.url})` : `#${r.id}`
            md += `| ${r.passed ? '✅' : '❌'} | ${mdCell(device)} | ${run} |\n`
        }
        md += '\n'
    }
    if (cases.length) {
        const failed = cases.filter(c => c.failure !== undefined)
        const skipped = cases.filter(c => c.skipped).length
        md += `**${cases.length - failed.length - skipped}** passed, **${failed.length}** failed`
        md += skipped ? `, **${skipped}** skipped` : ''
        md += ` of ${cases.length} tests.\n\n`
        if (failed.length) {
            md += '| Failed test | Error |\n|---|---|\n'
            for (const c of failed.slice(0, 50)) {
                md += `| \`${mdCell(c.classname)}.${mdCell(c.name)}\` | ${mdCell(c.failure ?? '')} |\n`
            }
            if (failed.length > 50)
                md += `\n${failed.length - 50} more failures in the JUnit report.\n`
        }
    }
    return md
}
