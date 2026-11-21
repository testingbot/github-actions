import {setFailed} from '@actions/core'
import {COMMON_FLAGS, FlagSpec, runCli} from '../lib/cli'

export const ESPRESSO_FLAGS: FlagSpec[] = [
    ...COMMON_FLAGS,
    {input: 'test-runner', flag: '--test-runner', kind: 'value'},
    {input: 'class', flag: '--class', kind: 'value'},
    {input: 'not-class', flag: '--not-class', kind: 'value'},
    {input: 'package', flag: '--package', kind: 'value'},
    {input: 'not-package', flag: '--not-package', kind: 'value'},
    {input: 'annotation', flag: '--annotation', kind: 'value'},
    {input: 'not-annotation', flag: '--not-annotation', kind: 'value'},
    {input: 'size', flag: '--size', kind: 'value'}
]

export async function run(): Promise<void> {
    await runCli({command: 'espresso', flags: ESPRESSO_FLAGS})
}

/* istanbul ignore next */
if (require.main === module) {
    // eslint-disable-next-line github/no-then
    run().catch(error =>
        setFailed(error instanceof Error ? error.message : String(error))
    )
}
