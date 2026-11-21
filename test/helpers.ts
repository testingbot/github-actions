import {mkdtempSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'

/** Sets action inputs the way the runner does (INPUT_<NAME> env vars). */
export function setInputs(inputs: Record<string, string>): void {
    for (const [name, value] of Object.entries(inputs)) {
        process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value
    }
}

const SAVED = {...process.env}

/** Restores process.env to what it was when the test file loaded. */
export function resetEnv(): void {
    for (const key of Object.keys(process.env)) {
        if (!(key in SAVED)) delete process.env[key]
    }
    Object.assign(process.env, SAVED)
    for (const key of Object.keys(process.env)) {
        if (
            key.startsWith('INPUT_') ||
            key.startsWith('GITHUB_') ||
            key.startsWith('TB_') ||
            key.startsWith('TESTINGBOT_') ||
            key === 'RUNNER_TEMP'
        ) {
            delete process.env[key]
        }
    }
}

export function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'tb-actions-test-'))
}

/** A GitHub run context, optionally for a pull_request event. */
export function githubEnv(options: {pr?: boolean} = {}): void {
    const dir = tempDir()
    const event = options.pr
        ? {
              pull_request: {
                  number: 42,
                  title: 'Add checkout | flow',
                  html_url: 'https://github.com/acme/storefront/pull/42',
                  head: {sha: 'abcdef1234567890', ref: 'feature/checkout'}
              }
          }
        : {head_commit: {message: 'Fix login\n\nlong body'}}
    writeFileSync(join(dir, 'event.json'), JSON.stringify(event))
    Object.assign(process.env, {
        GITHUB_REPOSITORY: 'acme/storefront',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_JOB: 'e2e',
        GITHUB_RUN_ID: '9876543210',
        GITHUB_RUN_NUMBER: '77',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SHA: 'merge0000000000',
        GITHUB_REF_NAME: options.pr ? '42/merge' : 'main',
        GITHUB_EVENT_NAME: options.pr ? 'pull_request' : 'push',
        GITHUB_EVENT_PATH: join(dir, 'event.json'),
        ...(options.pr ? {GITHUB_HEAD_REF: 'feature/checkout'} : {})
    })
}

export interface Call {
    url: string
    init?: RequestInit
}

/** A fetch stand-in that answers from a list of [status, body] responses. */
export function fakeFetch(
    responses: [number, unknown][],
    calls: Call[] = []
): (url: string, init?: RequestInit) => Promise<Response> {
    let i = 0
    return async (url: string, init?: RequestInit) => {
        calls.push({url, init})
        const [status, body] = responses[Math.min(i++, responses.length - 1)]
        if (status === 0) throw new Error('ECONNRESET')
        return new Response(
            typeof body === 'string' ? body : JSON.stringify(body),
            {status}
        )
    }
}
