import {getInput, setSecret} from '@actions/core'

export interface Credentials {
    key: string
    secret: string
}

/**
 * Resolves the TestingBot key and secret in the same order as the
 * testingbot CLI: action inputs, then TB_KEY / TB_SECRET, then
 * TESTINGBOT_KEY / TESTINGBOT_SECRET (what setup-env exports and what
 * several TestingBot samples read). Both values are masked in the log.
 */
export function resolveCredentials(
    env: typeof process.env = process.env
): Credentials {
    const key = getInput('key') || env['TB_KEY'] || env['TESTINGBOT_KEY'] || ''
    const secret =
        getInput('secret') || env['TB_SECRET'] || env['TESTINGBOT_SECRET'] || ''
    if (!key || !secret) {
        throw new Error(
            'TestingBot credentials are missing. Pass the key and secret inputs ' +
                '(from repository secrets), or run testingbot/github-actions/setup-env first. ' +
                'Find them at https://testingbot.com/members/user/api'
        )
    }
    setSecret(key)
    setSecret(secret)
    return {key, secret}
}
