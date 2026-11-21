import {openAsBlob} from 'fs'
import {basename} from 'path'
import {Credentials} from './credentials'

export const DEFAULT_API_BASE = 'https://api.testingbot.com/v1'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** One session (test) of a build, as returned by GET /v1/builds/:id. */
export interface TestingBotTest {
    id: number
    session_id: string
    name: string | null
    state: string
    success: boolean | null
    status_id?: number | null
    unknown?: boolean
    browser?: string | null
    browser_version?: string | null
    browser_display_name?: string | null
    os?: string | null
    duration?: number | null
    status_message?: string | null
    video?: string | null
    created_at?: string
    completed_at?: string | null
    build?: string | null
}

export interface StoredApp {
    id?: number
    app_url?: string
    state?: string
    version?: string
    type?: string
    name?: string
    [key: string]: unknown
}

export interface CiLink {
    repo: string
    commitSha: string
    pullRequestNumber?: string
}

export class TestingBotApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: string
    ) {
        super(message)
        this.name = 'TestingBotApiError'
    }
}

const STATUS_HINTS: Record<number, string> = {
    401: 'TestingBot rejected the credentials (HTTP 401). Check the key and secret.',
    403: 'TestingBot refused the request (HTTP 403). The account may be read-only or out of minutes.',
    404: 'Not found on TestingBot (HTTP 404).'
}

function errorMessage(status: number, body: string): string {
    let detail = ''
    try {
        const parsed = JSON.parse(body) as Record<string, unknown>
        detail = String(parsed['error'] ?? parsed['message'] ?? '')
    } catch {
        detail = body.slice(0, 200)
    }
    const hint =
        STATUS_HINTS[status] ?? `TestingBot API returned HTTP ${status}.`
    return detail ? `${hint} API said: ${detail}` : hint
}

export const sleep = async (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms))

/**
 * Minimal client for the TestingBot REST API (https://testingbot.com/support/api).
 * Retries network errors and 5xx responses; 4xx responses fail at once with
 * a readable message.
 */
export class TestingBotApi {
    private readonly auth: string

    constructor(
        credentials: Credentials,
        private readonly baseUrl: string = process.env['TB_API_BASE'] ||
            DEFAULT_API_BASE,
        private readonly fetchImpl: FetchLike = async (input, init) =>
            fetch(input, init),
        private readonly retryDelayMs = 2000
    ) {
        this.auth = `Basic ${Buffer.from(
            `${credentials.key}:${credentials.secret}`
        ).toString('base64')}`
    }

    async request<T>(
        method: string,
        path: string,
        body?: BodyInit,
        attempts = 3
    ): Promise<T> {
        let lastError: unknown
        for (let attempt = 1; attempt <= attempts; attempt++) {
            let response: Response
            try {
                response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                    method,
                    body,
                    headers: {
                        Authorization: this.auth,
                        Accept: 'application/json',
                        'User-Agent': 'testingbot-github-actions'
                    }
                })
            } catch (e) {
                lastError = e
                if (attempt < attempts) await sleep(this.retryDelayMs)
                continue
            }
            const text = await response.text()
            if (response.ok) {
                return (text ? JSON.parse(text) : {}) as T
            }
            lastError = new TestingBotApiError(
                errorMessage(response.status, text),
                response.status,
                text
            )
            if (response.status < 500) break
            if (attempt < attempts) await sleep(this.retryDelayMs)
        }
        if (lastError instanceof Error) throw lastError
        throw new Error(String(lastError))
    }

    /**
     * Every test in a build. `build` is the build identifier (the `build`
     * capability) or the numeric build id; the API accepts both.
     */
    async getBuildTests(build: string): Promise<TestingBotTest[]> {
        const tests: TestingBotTest[] = []
        const count = 100
        for (let offset = 0; ; offset += count) {
            const page = await this.request<{
                data: TestingBotTest[]
                meta?: {total?: number}
            }>(
                'GET',
                `/builds/${encodeURIComponent(build)}?offset=${offset}&count=${count}`
            )
            tests.push(...(page.data ?? []))
            const total = page.meta?.total ?? tests.length
            if (!page.data?.length || tests.length >= total) break
        }
        return tests
    }

    /** Find a build's numeric id by its identifier, among the newest builds. */
    async findBuildId(build: string): Promise<number | undefined> {
        if (/^\d+$/.test(build)) return Number(build)
        const page = await this.request<{
            data: {id: number; build_identifier: string}[]
        }>('GET', `/builds?offset=0&count=100`)
        return page.data?.find(b => b.build_identifier === build)?.id
    }

    /** Upload a local file to TestingBot storage. */
    async uploadFile(
        filePath: string,
        appKey?: string
    ): Promise<{app_url: string}> {
        const form = new FormData()
        form.append('file', await openAsBlob(filePath), basename(filePath))
        return this.request(
            'POST',
            appKey ? `/storage/${encodeURIComponent(appKey)}` : '/storage',
            form,
            // A multipart body cannot be replayed safely by every fetch
            // implementation; retry by re-running the whole upload instead.
            1
        )
    }

    /** Let TestingBot download the app from a public URL. */
    async uploadUrl(url: string, appKey?: string): Promise<{app_url: string}> {
        return this.request(
            'POST',
            appKey ? `/storage/${encodeURIComponent(appKey)}` : '/storage',
            new URLSearchParams({url})
        )
    }

    async getStoredApp(appUrl: string): Promise<StoredApp> {
        const key = appUrl.replace(/^tb:\/\//, '')
        return this.request('GET', `/storage/${encodeURIComponent(key)}`)
    }

    /** Link a build to a GitHub commit/PR so TestingBot posts a PR check. */
    async registerCi(build: string, link: CiLink): Promise<unknown> {
        const form = new URLSearchParams({
            repo: link.repo,
            commit_sha: link.commitSha
        })
        if (link.pullRequestNumber) {
            form.set('pull_request_number', link.pullRequestNumber)
        }
        return this.request(
            'POST',
            `/builds/${encodeURIComponent(build)}/ci`,
            form
        )
    }

    /** Tell TestingBot the build is finished so the PR check resolves. */
    async resolveCi(build: string): Promise<unknown> {
        return this.request('PUT', `/builds/${encodeURIComponent(build)}/ci`)
    }
}
