# TestingBot xcuitest

Runs your XCUITest tests on TestingBot iOS simulators and real devices, waits for the result, writes a JUnit report and fails the step when a test fails.

```yaml
- uses: testingbot/github-actions/xcuitest@v1
  with:
    key: ${{ secrets.TB_KEY }}
    secret: ${{ secrets.TB_SECRET }}
    app: build/MyApp.ipa
    test-app: build/MyAppUITests-Runner.zip
    device: iPhone 16
    real-device: true
```

Build with `xcodebuild build-for-testing`; `app` is the `.ipa` (real devices) or a zipped `.app` (simulators), `test-app` the zipped `*-Runner.app` from `Build/Products/Debug-iphoneos`.

## How it works

The action wraps the [`testingbot` CLI](https://github.com/testingbot/testingbotctl) (`npx @testingbot/cli xcuitest`), the same CLI the [Bitrise XCUITest step](https://github.com/testingbot/bitrise-step-testingbot-xcuitest) runs. The CLI uploads both apps, starts the run, polls until it finishes and downloads the JUnit report. The action then:

- merges the CLI's JUnit reports into one file (`junit-file` output),
- writes a job summary with the runs and every failed test with its error, and one annotation per failed test (up to 10),
- sets the outputs below and fails the step on failed tests (`fail-on-failure`, on by default) or when the run could not start.

Credentials are passed to the CLI as `TB_KEY` / `TB_SECRET` in its environment, never on the command line. The run is named after the PR title (or the commit message), joins `$TB_BUILD` when setup-env ran, and carries the PR head commit and PR number, so the [TestingBot GitHub App](https://testingbot.com/support/integrations/ci-cd/github-pr-checks) can post a check.

`only-testing`, `skip-testing`, `test-env`, `test-arg`, `app-env` and `app-arg` need a `@testingbot/cli` release newer than 1.5.0 (they are on the CLI main branch); with 1.5.0 the CLI stops with "unknown option".

Pin `cli-version` for reproducible builds. `async: true` starts the run and returns at once (no JUnit, no verdict); `dry-run: true` prints the request without uploading anything, which is handy to test a workflow.

## Inputs

| Input | Description | Default |
|---|---|---|
| `key` | TestingBot API key. Falls back to TB_KEY / TESTINGBOT_KEY. |  |
| `secret` | TestingBot API secret. Falls back to TB_SECRET / TESTINGBOT_SECRET. |  |
| `app` | Path to the app (.ipa for real devices, zipped .app for simulators). **Required.** |  |
| `test-app` | Path to the zipped *-Runner.app containing the XCUITests. **Required.** |  |
| `device` | Device name or regex, e.g. "Pixel 8" or "iPhone 1[56]". Default: any suitable device. |  |
| `platform-version` | OS version, e.g. "14" or "18.2". |  |
| `real-device` | Use a real device instead of an emulator/simulator. | `false` |
| `tablet-only` | Only allocate tablets. | `false` |
| `phone-only` | Only allocate phones. | `false` |
| `locale` | Device locale. |  |
| `timezone` | Device timezone, e.g. Europe/London. |  |
| `language` | App language (ISO 639-1). |  |
| `geo-country-code` | Geographic IP location (ISO country code). |  |
| `throttle-network` | Network throttling: 4G, 3G, Edge or airplane. |  |
| `name` | Name in the TestingBot dashboard. Default: PR title, else first line of the commit message. |  |
| `build` | Build to group the runs under. Default: $TB_BUILD (setup-env). |  |
| `tunnel` | Start a TestingBot Tunnel for the run (not with async). | `false` |
| `tunnel-identifier` | Identifier for the tunnel. |  |
| `retry` | Re-run a failed test up to N times (0-2). The last attempt decides. | `0` |
| `timeout` | Minutes to wait for results (CLI default 60). |  |
| `fail-fast` | Cancel the remaining runs at the first final failure. | `false` |
| `priority` | Queue priority among your own runs: high, normal or low. |  |
| `metadata` | Extra metadata shown on the run, one KEY=VALUE per line. |  |
| `download-artifacts` | Download video, logs and screenshots: all or failed. |  |
| `artifacts-output-dir` | Directory for the downloaded artifacts. Default: $RUNNER_TEMP/testingbot-artifacts. |  |
| `report-output-dir` | Directory for the CLI's JUnit reports. Default: $RUNNER_TEMP/testingbot-<command>-reports. |  |
| `junit-file` | Path of the merged JUnit file. Default: $RUNNER_TEMP/testingbot-<command>-junit.xml. |  |
| `fail-on-failure` | Fail the step when tests fail. With false, failures are only annotated. | `true` |
| `async` | Start the run and return at once; no results, no JUnit. | `false` |
| `dry-run` | Validate and print the request without uploading or running. | `false` |
| `cli-version` | Version of @testingbot/cli to run. | `latest` |
| `extra-args` | Extra raw arguments for the testingbot command. |  |
| `orientation` | PORTRAIT or LANDSCAPE. |  |
| `only-testing` | Only these tests (comma-separated, e.g. MyUITests/LoginTests). |  |
| `skip-testing` | Skip these tests. |  |
| `test-env` | Environment for the test runner, one KEY=VALUE per line. |  |
| `test-arg` | Launch arguments for the test runner, one per line. |  |
| `app-env` | Environment for the app, one KEY=VALUE per line. |  |
| `app-arg` | Launch arguments for the app, one per line. |  |

## Outputs

| Output | Description |
|---|---|
| `outcome` | passed, failed, started (async), dry-run or error. |
| `console-url` | Link to the run in the TestingBot dashboard. |
| `app-id` | TestingBot project id of the run. |
| `runs` | JSON array of runs: id, status, passed, device, url. |
| `results-file` | Path to the JSON results written by the CLI. |
| `junit-file` | Path to the merged JUnit report (not with async or dry-run). |
