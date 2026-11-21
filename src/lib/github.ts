import {existsSync, readFileSync} from 'fs'

/** The parts of the GitHub Actions run context the actions use. */
export interface RunContext {
    repository: string // owner/repo
    repo: string // repo
    workflow: string
    job: string
    runId: string
    runNumber: string
    runAttempt: string
    sha: string
    refName: string
    serverUrl: string
    eventName: string
    pr?: {
        number: number
        title: string
        headSha: string
        headRef: string
        url: string
    }
    commitMessage?: string
}

interface EventPayload {
    pull_request?: {
        number: number
        title: string
        html_url: string
        head: {sha: string; ref: string}
    }
    head_commit?: {message?: string}
}

export function runContext(env: typeof process.env = process.env): RunContext {
    const repository = env['GITHUB_REPOSITORY'] || ''
    let event: EventPayload = {}
    const eventPath = env['GITHUB_EVENT_PATH']
    if (eventPath && existsSync(eventPath)) {
        try {
            event = JSON.parse(readFileSync(eventPath, 'utf8')) as EventPayload
        } catch {
            event = {}
        }
    }
    const pr = event.pull_request
    return {
        repository,
        repo: repository.split('/').pop() || '',
        workflow: env['GITHUB_WORKFLOW'] || '',
        job: env['GITHUB_JOB'] || '',
        runId: env['GITHUB_RUN_ID'] || '',
        runNumber: env['GITHUB_RUN_NUMBER'] || '',
        runAttempt: env['GITHUB_RUN_ATTEMPT'] || '1',
        sha: env['GITHUB_SHA'] || '',
        refName: env['GITHUB_HEAD_REF'] || env['GITHUB_REF_NAME'] || '',
        serverUrl: env['GITHUB_SERVER_URL'] || 'https://github.com',
        eventName: env['GITHUB_EVENT_NAME'] || '',
        pr: pr
            ? {
                  number: pr.number,
                  title: pr.title,
                  headSha: pr.head.sha,
                  headRef: pr.head.ref,
                  url: pr.html_url
              }
            : undefined,
        commitMessage: event.head_commit?.message
    }
}

/** Lowercase, URL-path-safe: letters, digits, dots, dashes and underscores. */
export function slug(text: string, max = 40): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, max)
        .replace(/-$/, '')
}

/**
 * Expands {repo}, {workflow}, {job}, {run_id}, {run_number}, {attempt},
 * {ref}, {pr}, {branch} and {sha} in a template.
 */
export function expandTemplate(template: string, ctx: RunContext): string {
    const ref = ctx.pr ? `pr-${ctx.pr.number}` : slug(ctx.refName)
    const values: Record<string, string> = {
        repo: ctx.repo,
        repository: ctx.repository,
        workflow: ctx.workflow,
        job: ctx.job,
        run_id: ctx.runId,
        run_number: ctx.runNumber,
        attempt: ctx.runAttempt,
        ref,
        pr: ctx.pr ? String(ctx.pr.number) : '',
        branch: ctx.pr ? ctx.pr.headRef : ctx.refName,
        sha: (ctx.pr?.headSha || ctx.sha).slice(0, 7)
    }
    return template.replace(/\{([a-z_]+)\}/g, (match, name: string) =>
        name in values ? values[name] : match
    )
}

/**
 * Default build name: one TestingBot build per workflow run attempt, so every
 * job (and matrix leg) of the run lands in the same build. URL-path safe on
 * purpose: the docs call `/v1/builds/$TB_BUILD/ci` with the raw value.
 * Example: github-storefront-pr-42-9876543210-1
 */
export const DEFAULT_BUILD_TEMPLATE = 'github-{repo}-{ref}-{run_id}-{attempt}'

export function defaultBuildName(ctx: RunContext): string {
    const name = expandTemplate(DEFAULT_BUILD_TEMPLATE, {
        ...ctx,
        repo: slug(ctx.repo, 30)
    })
    return name.replace(/-+/g, '-')
}

/** The SHA a PR check must be posted on: the PR head, not the merge commit. */
export function checkSha(ctx: RunContext): string {
    return ctx.pr?.headSha || ctx.sha
}
