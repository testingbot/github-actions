import {describe, it} from 'mocha'
import {strict as assert} from 'assert'
import {writeFileSync} from 'fs'
import {join} from 'path'
import {TestingBotApi, TestingBotApiError} from '../src/lib/api'
import {Call, fakeFetch, tempDir} from './helpers'

const creds = {key: 'key', secret: 'secret'}
const api = (responses: [number, unknown][], calls: Call[] = []) =>
    new TestingBotApi(
        creds,
        'https://api.test/v1',
        fakeFetch(responses, calls),
        0
    )

describe('TestingBotApi', () => {
    it('sends basic auth and pages through a build', async () => {
        const calls: Call[] = []
        const page = (ids: number[], total: number) => ({
            data: ids.map(id => ({id})),
            meta: {total}
        })
        const ids = Array.from({length: 100}, (_, i) => i)
        const tests = await api(
            [
                [200, page(ids, 101)],
                [200, page([100], 101)]
            ],
            calls
        ).getBuildTests('my build/1')
        assert.equal(tests.length, 101)
        assert.equal(
            calls[0].url,
            'https://api.test/v1/builds/my%20build%2F1?offset=0&count=100'
        )
        assert.ok(calls[1].url.includes('offset=100'))
        const headers = calls[0].init?.headers as Record<string, string>
        assert.equal(
            headers['Authorization'],
            `Basic ${Buffer.from('key:secret').toString('base64')}`
        )
    })

    it('retries 5xx and network errors, then succeeds', async () => {
        const calls: Call[] = []
        const result = await api(
            [
                [0, ''],
                [502, 'bad gateway'],
                [200, {data: [], meta: {total: 0}}]
            ],
            calls
        ).getBuildTests('b')
        assert.deepEqual(result, [])
        assert.equal(calls.length, 3)
    })

    it('fails at once on 401 with a readable message', async () => {
        const calls: Call[] = []
        await assert.rejects(
            api([[401, {error: 'Unauthorized'}]], calls).getBuildTests('b'),
            (e: TestingBotApiError) =>
                e.status === 401 &&
                /credentials/.test(e.message) &&
                /Unauthorized/.test(e.message)
        )
        assert.equal(calls.length, 1)
    })

    it('uploads a file as multipart to /storage or /storage/<key>', async () => {
        const dir = tempDir()
        const file = join(dir, 'app.apk')
        writeFileSync(file, 'PK fake apk')
        const calls: Call[] = []
        const client = api([[200, {app_url: 'tb://abc'}]], calls)
        assert.deepEqual(await client.uploadFile(file), {app_url: 'tb://abc'})
        assert.equal(calls[0].url, 'https://api.test/v1/storage')
        assert.equal(calls[0].init?.method, 'POST')
        const form = calls[0].init?.body as FormData
        const blob = form.get('file') as File
        assert.equal(blob.name, 'app.apk')
        assert.equal(await blob.text(), 'PK fake apk')
        await client.uploadFile(file, 'my-app')
        assert.equal(calls[1].url, 'https://api.test/v1/storage/my-app')
    })

    it('registers and resolves the CI link', async () => {
        const calls: Call[] = []
        const client = api([[200, {}]], calls)
        await client.registerCi('b-1', {
            repo: 'acme/storefront',
            commitSha: 'abc',
            pullRequestNumber: '42'
        })
        await client.resolveCi('b-1')
        assert.equal(calls[0].url, 'https://api.test/v1/builds/b-1/ci')
        assert.equal(
            String(calls[0].init?.body),
            'repo=acme%2Fstorefront&commit_sha=abc&pull_request_number=42'
        )
        assert.equal(calls[1].init?.method, 'PUT')
    })

    it('finds a build id by identifier', async () => {
        const client = api([
            [
                200,
                {
                    data: [
                        {id: 5, build_identifier: 'x'},
                        {id: 7, build_identifier: 'y'}
                    ]
                }
            ]
        ])
        assert.equal(await client.findBuildId('y'), 7)
        assert.equal(await client.findBuildId('123'), 123)
    })
})
