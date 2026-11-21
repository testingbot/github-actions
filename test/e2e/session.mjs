// Starts one TestingBot WebDriver session with the env setup-env exports
// (TB_KEY, TB_SECRET, TB_BUILD, TB_TUNNEL_IDENTIFIER), opens E2E_URL, checks
// the title and marks the test passed or failed, so the report action has a
// real build to report on. No dependencies: plain fetch against the hub.
const hub = 'https://hub.testingbot.com/wd/hub'
const {TB_KEY, TB_SECRET, TB_BUILD, TB_TUNNEL_IDENTIFIER} = process.env
const url = process.env.E2E_URL || 'https://testingbot.com'
const expect = process.env.E2E_TITLE || 'TestingBot'
const useTunnel = process.env.E2E_TUNNEL === 'true'

async function wd(method, path, body) {
    const res = await fetch(`${hub}${path}`, {
        method,
        headers: {'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined
    })
    const json = await res.json()
    if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value ?? json)}`)
    return json.value
}

const options = {
    key: TB_KEY,
    secret: TB_SECRET,
    build: TB_BUILD,
    name: process.env.E2E_NAME || 'github-actions self-test'
}
if (useTunnel) options['tunnel-identifier'] = TB_TUNNEL_IDENTIFIER

const session = await wd('POST', '/session', {
    capabilities: {
        alwaysMatch: {
            browserName: 'chrome',
            browserVersion: 'latest',
            platformName: 'WIN11',
            'tb:options': options
        }
    }
})
const id = session.sessionId
let passed = false
try {
    await wd('POST', `/session/${id}/url`, {url})
    const title = await wd('GET', `/session/${id}/title`)
    passed = title.includes(expect)
    console.log(`Title: ${title} -> ${passed ? 'passed' : 'failed'}`)
} finally {
    await wd('DELETE', `/session/${id}`)
    await fetch(`https://api.testingbot.com/v1/tests/${id}`, {
        method: 'PUT',
        headers: {
            Authorization: `Basic ${Buffer.from(`${TB_KEY}:${TB_SECRET}`).toString('base64')}`
        },
        body: new URLSearchParams({'test[success]': passed ? '1' : '0'})
    })
}
if (!passed) process.exitCode = 1
