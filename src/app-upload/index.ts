import {
    exportVariable,
    getBooleanInput,
    getInput,
    info,
    setFailed,
    setOutput,
    warning
} from '@actions/core'
import {existsSync, statSync} from 'fs'
import {extname} from 'path'
import {StoredApp, TestingBotApi, sleep} from '../lib/api'
import {resolveCredentials} from '../lib/credentials'

export const EXTENSIONS = ['.apk', '.aab', '.ipa', '.zip']

function intInput(name: string, fallback: number): number {
    const value = parseInt(getInput(name), 10)
    return Number.isFinite(value) && value >= 0 ? value : fallback
}

function size(bytes: number): string {
    return bytes > 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(bytes / 1024)} KB`
}

/**
 * TestingBot extracts version, platform and icon after the upload returns:
 * `state` is PROCESSING until that is done. The app is usable either way, so
 * waiting only makes the metadata outputs reliable and never fails the step.
 */
export async function readMetadata(
    api: TestingBotApi,
    appUrl: string,
    wait: boolean,
    timeoutSeconds: number,
    pollSeconds = 3
): Promise<StoredApp | undefined> {
    const deadline = Date.now() + timeoutSeconds * 1000
    try {
        let app = await api.getStoredApp(appUrl)
        while (wait && app.state === 'PROCESSING' && Date.now() < deadline) {
            await sleep(pollSeconds * 1000)
            app = await api.getStoredApp(appUrl)
        }
        if (app.state === 'PROCESSING') {
            warning(
                'TestingBot is still processing the app; app-version may be empty.'
            )
        }
        return app
    } catch (e) {
        warning(
            `Uploaded, but reading the app metadata failed: ${e instanceof Error ? e.message : String(e)}`
        )
        return undefined
    }
}

export async function run(): Promise<void> {
    const credentials = resolveCredentials()
    const api = new TestingBotApi(credentials)
    const file = getInput('file')
    const url = getInput('url')
    const appKey = getInput('app-key') || undefined

    if (!file === !url) {
        throw new Error('Set exactly one of the file and url inputs.')
    }

    let result: {app_url: string}
    if (url) {
        info(`Uploading to TestingBot from ${url}`)
        result = await api.uploadUrl(url, appKey)
    } else {
        if (!existsSync(file)) {
            throw new Error(`App file not found: ${file}`)
        }
        const stat = statSync(file)
        if (stat.isDirectory()) {
            throw new Error(
                `${file} is a directory. Zip a .app bundle first (e.g. ditto -c -k --keepParent My.app My.zip).`
            )
        }
        if (!EXTENSIONS.includes(extname(file).toLowerCase())) {
            warning(
                `${file} is not one of ${EXTENSIONS.join(', ')}; uploading anyway.`
            )
        }
        info(`Uploading ${file} (${size(stat.size)}) to TestingBot storage`)
        result = await api.uploadFile(file, appKey)
    }

    const appUrl = result.app_url
    if (!appUrl) {
        throw new Error(
            `TestingBot accepted the upload but returned no app_url: ${JSON.stringify(result)}`
        )
    }
    info(`Uploaded: ${appUrl}`)
    setOutput('app-url', appUrl)
    exportVariable('TESTINGBOT_APP_URL', appUrl)
    exportVariable('TB_APP_URL', appUrl)

    const app = await readMetadata(
        api,
        appUrl,
        getBooleanInput('wait-for-processing'),
        intInput('processing-timeout', 300)
    )
    if (app) {
        setOutput('app-id', app.id !== undefined ? String(app.id) : '')
        setOutput('app-version', app.version ?? '')
        setOutput('app-state', app.state ?? '')
        if (app.version) info(`Version: ${app.version}`)
    }
}

/* istanbul ignore next */
if (require.main === module) {
    // eslint-disable-next-line github/no-then
    run().catch(error =>
        setFailed(error instanceof Error ? error.message : String(error))
    )
}
