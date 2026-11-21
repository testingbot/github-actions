import {
    getBooleanInput,
    getInput,
    info,
    setFailed,
    setOutput,
    summary,
    warning
} from '@actions/core'
import {mkdirSync, writeFileSync} from 'fs'
import {dirname, resolve} from 'path'
import {TestingBotApi} from '../lib/api'
import {upsertPrComment} from '../lib/comment'
import {resolveCredentials} from '../lib/credentials'
import {defaultBuildName, runContext} from '../lib/github'
import {
    buildUrl,
    count,
    fetchBuild,
    outcomeOf,
    renderJUnit,
    renderMarkdown
} from '../lib/report'

function intInput(name: string, fallback: number): number {
    const value = parseInt(getInput(name), 10)
    return Number.isFinite(value) && value >= 0 ? value : fallback
}

export async function run(): Promise<void> {
    const credentials = resolveCredentials()
    const ctx = runContext()
    const build =
        getInput('build-name') ||
        process.env['TB_BUILD'] ||
        process.env['TESTINGBOT_BUILD'] ||
        defaultBuildName(ctx)
    const api = new TestingBotApi(credentials)

    info(`Fetching TestingBot build ${build}`)
    const tests = await fetchBuild(api, build, {
        timeoutSeconds: intInput('wait-timeout', 120),
        pollSeconds: intInput('poll-interval', 10),
        log: info
    })
    let buildId: number | undefined
    try {
        buildId = await api.findBuildId(build)
    } catch {
        // Only the dashboard link needs the id; the table works without it.
    }
    const counts = count(tests)
    const outcome = outcomeOf(counts)
    const markdown = renderMarkdown(tests, {
        build,
        buildId,
        maxRows: intInput('max-rows', 100)
    })

    setOutput('build-name', build)
    setOutput('build-url', buildUrl(buildId))
    if (buildId) setOutput('build-id', String(buildId))
    setOutput('outcome', outcome)
    setOutput('total', String(counts.total))
    setOutput('passed', String(counts.passed))
    setOutput('failed', String(counts.failed))
    setOutput('unknown', String(counts.unknown + counts.running))
    info(
        `${counts.passed} passed, ${counts.failed} failed, ${counts.unknown} without result, ${counts.running} running (${counts.total} total)`
    )

    if (process.env['GITHUB_STEP_SUMMARY']) {
        await summary.addRaw(markdown, true).write()
    }

    const junitFile = getInput('junit-file')
    if (junitFile) {
        const path = resolve(junitFile)
        mkdirSync(dirname(path), {recursive: true})
        writeFileSync(path, renderJUnit(tests, build))
        setOutput('junit-file', path)
        info(`JUnit report written to ${path}`)
    }

    if (getBooleanInput('comment-on-pr')) {
        const token = getInput('github-token')
        if (!ctx.pr) {
            info('comment-on-pr: not a pull_request event, no comment.')
        } else if (!token) {
            warning('comment-on-pr needs github-token.')
        } else {
            try {
                const result = await upsertPrComment({
                    token,
                    repository: ctx.repository,
                    prNumber: ctx.pr.number,
                    tag: getInput('comment-tag') || ctx.workflow,
                    body: markdown
                })
                info(`PR comment ${result}.`)
            } catch (e) {
                // Fork PRs get a read-only token; never fail the job over it.
                warning(
                    `Could not comment on the pull request: ${e instanceof Error ? e.message : String(e)}`
                )
            }
        }
    }

    if (getBooleanInput('resolve-pr-check') && ctx.pr) {
        try {
            await api.resolveCi(build)
            info('Signalled TestingBot that the build is finished (PR check).')
        } catch (e) {
            warning(
                `Could not resolve the TestingBot PR check: ${e instanceof Error ? e.message : String(e)}`
            )
        }
    }

    if (getBooleanInput('fail-on-failure')) {
        if (outcome === 'failed') {
            setFailed(`${counts.failed} TestingBot tests failed.`)
        } else if (outcome === 'no-tests') {
            setFailed(`TestingBot build ${build} has no tests.`)
        }
    }
}

/* istanbul ignore next */
if (require.main === module) {
    // eslint-disable-next-line github/no-then
    run().catch(error =>
        setFailed(error instanceof Error ? error.message : String(error))
    )
}
