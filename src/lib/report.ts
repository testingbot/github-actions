import {TestingBotApi, TestingBotApiError, TestingBotTest, sleep} from './api'

export const DASHBOARD = 'https://testingbot.com/members'

export type TestStatus = 'passed' | 'failed' | 'unknown' | 'running'

export function classify(test: TestingBotTest): TestStatus {
    if (test.state && test.state !== 'COMPLETE') return 'running'
    if (test.success === true) return 'passed'
    if (test.unknown || test.success === null || test.success === undefined) {
        return 'unknown'
    }
    return 'failed'
}

export interface Counts {
    total: number
    passed: number
    failed: number
    unknown: number
    running: number
}

export function count(tests: TestingBotTest[]): Counts {
    const counts: Counts = {
        total: tests.length,
        passed: 0,
        failed: 0,
        unknown: 0,
        running: 0
    }
    for (const t of tests) counts[classify(t)]++
    return counts
}

export type Outcome = 'passed' | 'failed' | 'running' | 'no-tests'

export function outcomeOf(counts: Counts): Outcome {
    if (counts.total === 0) return 'no-tests'
    if (counts.failed > 0) return 'failed'
    if (counts.running > 0) return 'running'
    return 'passed'
}

export function sessionUrl(test: TestingBotTest): string {
    return `${DASHBOARD}/tests/${test.session_id || test.id}`
}

export function buildUrl(buildId?: number): string {
    return buildId ? `${DASHBOARD}/builds/${buildId}` : `${DASHBOARD}/builds`
}

export function environment(test: TestingBotTest): string {
    if (test.browser_display_name) {
        // "Chrome | Pixel 8 - 14.0" for devices, "Chrome 157" for desktop.
        return test.os && !test.browser_display_name.includes('|')
            ? `${test.browser_display_name} · ${test.os}`
            : test.browser_display_name
    }
    return [test.browser, test.browser_version, test.os]
        .filter(Boolean)
        .join(' ')
}

export interface WaitOptions {
    timeoutSeconds: number
    pollSeconds: number
    log?: (message: string) => void
}

/**
 * Fetches the build's tests, polling while the build has no tests yet or
 * still has running ones, up to `timeoutSeconds`. Returns what it has then.
 */
export async function fetchBuild(
    api: TestingBotApi,
    build: string,
    options: WaitOptions
): Promise<TestingBotTest[]> {
    const deadline = Date.now() + options.timeoutSeconds * 1000
    for (;;) {
        let tests: TestingBotTest[] = []
        try {
            tests = await api.getBuildTests(build)
        } catch (e) {
            // A build appears with its first session; until then it is a 404.
            if (!(e instanceof TestingBotApiError && e.status === 404)) {
                throw e
            }
        }
        const counts = count(tests)
        const settled = counts.total > 0 && counts.running === 0
        if (settled || Date.now() >= deadline) return tests
        options.log?.(
            counts.total === 0
                ? `Build ${build} has no tests yet, waiting...`
                : `${counts.running} of ${counts.total} tests still running, waiting...`
        )
        await sleep(Math.min(options.pollSeconds * 1000, deadline - Date.now()))
    }
}

const ICON: Record<TestStatus, string> = {
    passed: '✅',
    failed: '❌',
    unknown: '❔',
    running: '⏳'
}

const ORDER: Record<TestStatus, number> = {
    failed: 0,
    unknown: 1,
    running: 2,
    passed: 3
}

function cell(text: string | null | undefined, max = 120): string {
    const clean = (text ?? '')
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '\\|')
        .trim()
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function duration(seconds?: number | null): string {
    if (seconds === null || seconds === undefined) return ''
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export interface RenderOptions {
    build: string
    buildId?: number
    maxRows: number
}

/** The job summary / PR comment body. */
export function renderMarkdown(
    tests: TestingBotTest[],
    options: RenderOptions
): string {
    const counts = count(tests)
    const outcome = outcomeOf(counts)
    const head: Record<Outcome, string> = {
        passed: '✅ TestingBot: all tests passed',
        failed: '❌ TestingBot: tests failed',
        running: '⏳ TestingBot: tests still running',
        'no-tests': '⚠️ TestingBot: no tests found'
    }
    const url = buildUrl(options.buildId)
    let md = `### ${head[outcome]}\n\n`
    md += `Build [\`${options.build}\`](${url})`
    if (counts.total === 0) {
        md += ` has no tests. Check that your tests send the \`build\` capability (\`TB_BUILD\`).\n`
        return md
    }
    const parts = [`**${counts.passed}** passed`, `**${counts.failed}** failed`]
    if (counts.unknown) parts.push(`**${counts.unknown}** without result`)
    if (counts.running) parts.push(`**${counts.running}** running`)
    md += `: ${parts.join(', ')} of ${counts.total} tests.\n\n`

    const sorted = [...tests].sort(
        (a, b) => ORDER[classify(a)] - ORDER[classify(b)] || a.id - b.id
    )
    md += '| | Test | Environment | Duration | Links |\n'
    md += '|---|---|---|---|---|\n'
    for (const t of sorted.slice(0, options.maxRows)) {
        const status = classify(t)
        const links = [`[Session](${sessionUrl(t)})`]
        if (t.video) links.push(`[Video](${t.video})`)
        let name = cell(t.name || `Test ${t.id}`)
        if (status === 'failed' && t.status_message) {
            name += `<br><sub>${cell(t.status_message, 200)}</sub>`
        }
        md += `| ${ICON[status]} | ${name} | ${cell(environment(t))} | ${duration(t.duration)} | ${links.join(' · ')} |\n`
    }
    if (sorted.length > options.maxRows) {
        md += `\n${sorted.length - options.maxRows} more tests on [TestingBot](${url}).\n`
    }
    return md
}

function xml(text: string | null | undefined): string {
    return (
        (text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    )
}

/** A JUnit document: one testcase per session, classname = environment. */
export function renderJUnit(tests: TestingBotTest[], build: string): string {
    const counts = count(tests)
    const time = tests.reduce((sum, t) => sum + (t.duration ?? 0), 0)
    let out = '<?xml version="1.0" encoding="UTF-8"?>\n'
    out += `<testsuites name="TestingBot" tests="${counts.total}" failures="${counts.failed}" skipped="${counts.unknown + counts.running}" time="${time}">\n`
    out += `  <testsuite name="${xml(build)}" tests="${counts.total}" failures="${counts.failed}" skipped="${counts.unknown + counts.running}" time="${time}">\n`
    for (const t of tests) {
        const status = classify(t)
        out += `    <testcase name="${xml(t.name || `Test ${t.id}`)}" classname="${xml(environment(t))}" time="${t.duration ?? 0}">\n`
        if (status === 'failed') {
            out += `      <failure message="${xml(t.status_message || 'Test failed')}">${xml(sessionUrl(t))}</failure>\n`
        } else if (status !== 'passed') {
            out += `      <skipped message="${status === 'running' ? 'Still running' : 'No result reported'}"/>\n`
        }
        out += `      <system-out>${xml(sessionUrl(t))}</system-out>\n`
        out += '    </testcase>\n'
    }
    out += '  </testsuite>\n</testsuites>\n'
    return out
}
