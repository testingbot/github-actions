import {describe, it, afterEach} from 'mocha'
import {strict as assert} from 'assert'
import {
    defaultBuildName,
    expandTemplate,
    runContext,
    slug,
    checkSha
} from '../src/lib/github'
import {githubEnv, resetEnv} from './helpers'

describe('github context', () => {
    afterEach(resetEnv)

    it('reads a push run', () => {
        githubEnv()
        const ctx = runContext()
        assert.equal(ctx.repo, 'storefront')
        assert.equal(ctx.pr, undefined)
        assert.equal(ctx.commitMessage, 'Fix login\n\nlong body')
        assert.equal(
            defaultBuildName(ctx),
            'github-storefront-main-9876543210-2'
        )
        assert.equal(checkSha(ctx), 'merge0000000000')
    })

    it('reads a pull_request run and uses the head SHA', () => {
        githubEnv({pr: true})
        const ctx = runContext()
        assert.equal(ctx.pr?.number, 42)
        assert.equal(ctx.refName, 'feature/checkout')
        assert.equal(
            defaultBuildName(ctx),
            'github-storefront-pr-42-9876543210-2'
        )
        assert.equal(checkSha(ctx), 'abcdef1234567890')
    })

    it('expands templates and leaves unknown placeholders alone', () => {
        githubEnv({pr: true})
        assert.equal(
            expandTemplate(
                '{workflow} #{run_number}.{attempt} {branch} {sha} {nope}',
                runContext()
            ),
            'CI #77.2 feature/checkout abcdef1 {nope}'
        )
    })

    it('slugs to URL-path-safe text', () => {
        assert.equal(slug('Feature/Über Cool!!'), 'feature-ber-cool')
        assert.equal(slug('a'.repeat(50), 10), 'aaaaaaaaaa')
    })

    it('survives a missing or broken event file', () => {
        process.env['GITHUB_EVENT_PATH'] = '/nonexistent/event.json'
        assert.equal(runContext().pr, undefined)
    })
})
