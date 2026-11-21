import {setFailed} from '@actions/core'
import {COMMON_FLAGS, FlagSpec, runCli} from '../lib/cli'

export const XCUITEST_FLAGS: FlagSpec[] = [
    ...COMMON_FLAGS,
    {input: 'orientation', flag: '--orientation', kind: 'value'},
    {input: 'only-testing', flag: '--only-testing', kind: 'value'},
    {input: 'skip-testing', flag: '--skip-testing', kind: 'value'},
    {input: 'test-env', flag: '--test-env', kind: 'lines'},
    {input: 'test-arg', flag: '--test-arg', kind: 'lines'},
    {input: 'app-env', flag: '--app-env', kind: 'lines'},
    {input: 'app-arg', flag: '--app-arg', kind: 'lines'}
]

export async function run(): Promise<void> {
    await runCli({command: 'xcuitest', flags: XCUITEST_FLAGS})
}

/* istanbul ignore next */
if (require.main === module) {
    // eslint-disable-next-line github/no-then
    run().catch(error =>
        setFailed(error instanceof Error ? error.message : String(error))
    )
}
