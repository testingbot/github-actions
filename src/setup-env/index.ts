import {
    exportVariable,
    getBooleanInput,
    getInput,
    info,
    setFailed,
    setOutput,
    warning
} from '@actions/core'
import {randomBytes} from 'crypto'
import {TestingBotApi} from '../lib/api'
import {resolveCredentials} from '../lib/credentials'
import {
    checkSha,
    defaultBuildName,
    expandTemplate,
    runContext,
    slug
} from '../lib/github'

/**
 * Environment variable names TestingBot tools read, checked against the
 * sources:
 * - TB_KEY / TB_SECRET: @testingbot/cli, testingbot-tunnel-launcher,
 *   testcafe-browser-provider-testingbot, the GitHub Actions docs samples.
 * - TESTINGBOT_KEY / TESTINGBOT_SECRET: the tunnel itself, the nightwatch/jest
 *   samples, mobilewright-testingbot, Jenkins, Buildkite, GitLab docs.
 * - TB_BUILD (testcafe provider, GitHub/CircleCI docs) and TESTINGBOT_BUILD
 *   (mobilewright-testingbot, Buildkite, CodePipeline, Bitrise).
 * - TB_TUNNEL_IDENTIFIER (testcafe provider, CircleCI orb) and
 *   TESTINGBOT_TUNNEL_IDENTIFIER (Buildkite, Bitrise, CodePipeline).
 */
export const ENV = {
    key: ['TB_KEY', 'TESTINGBOT_KEY'],
    secret: ['TB_SECRET', 'TESTINGBOT_SECRET'],
    build: ['TB_BUILD', 'TESTINGBOT_BUILD'],
    tunnel: ['TB_TUNNEL_IDENTIFIER', 'TESTINGBOT_TUNNEL_IDENTIFIER']
} as const

function exportAll(names: readonly string[], value: string): void {
    for (const name of names) exportVariable(name, value)
}

export async function run(): Promise<void> {
    const credentials = resolveCredentials()
    const ctx = runContext()

    const template = getInput('build-name')
    const buildName = template
        ? expandTemplate(template, ctx)
        : defaultBuildName(ctx)

    // A tunnel belongs to one job: matrix legs of the same job run on
    // different runners, so a shared identifier would route one leg's
    // sessions through another leg's tunnel. Hence the random suffix.
    const tunnelIdentifier =
        getInput('tunnel-identifier') ||
        [
            'github',
            ctx.runId,
            ctx.runAttempt,
            slug(ctx.job, 20),
            randomBytes(3).toString('hex')
        ]
            .filter(Boolean)
            .join('-')

    if (getBooleanInput('export-credentials')) {
        exportAll(ENV.key, credentials.key)
        exportAll(ENV.secret, credentials.secret)
        info(`Exported ${[...ENV.key, ...ENV.secret].join(', ')}`)
    }
    exportAll(ENV.build, buildName)
    exportAll(ENV.tunnel, tunnelIdentifier)
    info(`Build name (${ENV.build.join(', ')}): ${buildName}`)
    info(`Tunnel identifier (${ENV.tunnel.join(', ')}): ${tunnelIdentifier}`)
    setOutput('build-name', buildName)
    setOutput('tunnel-identifier', tunnelIdentifier)

    if (getBooleanInput('pr-check')) {
        if (!ctx.pr) {
            info('pr-check: not a pull_request event, no check registered.')
            return
        }
        try {
            await new TestingBotApi(credentials).registerCi(buildName, {
                repo: ctx.repository,
                commitSha: checkSha(ctx),
                pullRequestNumber: String(ctx.pr.number)
            })
            info(
                `Registered build ${buildName} for the TestingBot PR check on ${ctx.repository}@${checkSha(ctx)}`
            )
        } catch (e) {
            // Never fail the tests over the check; the report action (or the
            // TestingBot watchdog) resolves it later.
            warning(
                `Could not register the TestingBot PR check: ${e instanceof Error ? e.message : String(e)}`
            )
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
