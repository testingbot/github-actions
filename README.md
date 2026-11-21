# TestingBot GitHub Actions

GitHub Actions for running tests on [TestingBot](https://testingbot.com) and reporting the results in GitHub.

| Action | What it does |
|---|---|
| [`setup-env`](./setup-env) | Exports `TB_KEY` / `TB_SECRET`, a build name (`TB_BUILD`) and a tunnel identifier (`TB_TUNNEL_IDENTIFIER`), plus their `TESTINGBOT_*` spellings, for your tests and the other actions. Optionally registers the build for the TestingBot PR check. |
| [`report`](./report) | After the tests: fetches the build from the TestingBot API and writes a job summary with every session, links to sessions and videos. Optional JUnit file, sticky PR comment and fail-on-failure. |
| [`app-upload`](./app-upload) | Uploads an `.apk`, `.aab`, `.ipa` or `.zip` to TestingBot storage and outputs the `tb://` app URL for Appium. |
| [`espresso`](./espresso) | Runs an Espresso suite with the `testingbot` CLI, waits for it, emits JUnit and fails the job on failures. |
| [`xcuitest`](./xcuitest) | The same for XCUITest. |

Two more TestingBot actions live in their own repositories and work with these:

- [`testingbot/testingbot-tunnel-action`](https://github.com/testingbot/testingbot-tunnel-action) starts the TestingBot Tunnel, so TestingBot browsers and devices reach a site running on the runner.
- [`testingbot/maestro-action`](https://github.com/testingbot/maestro-action) runs Maestro flows.

## Selenium / Playwright / Appium example

Add your TestingBot key and secret as the repository secrets `TB_KEY` and `TB_SECRET` ([member area](https://testingbot.com/members/user/api)).

```yaml
name: E2E
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write      # for comment-on-pr
    steps:
      - uses: actions/checkout@v4

      - uses: testingbot/github-actions/setup-env@v1
        with:
          key: ${{ secrets.TB_KEY }}
          secret: ${{ secrets.TB_SECRET }}

      # Only needed when the site under test runs on the runner.
      - uses: testingbot/testingbot-tunnel-action@v2
        with:
          key: ${{ secrets.TB_KEY }}
          secret: ${{ secrets.TB_SECRET }}
          tunnelIdentifier: ${{ env.TB_TUNNEL_IDENTIFIER }}

      - run: npm ci && npm test
        # In your capabilities: build: process.env.TB_BUILD,
        # 'tunnel-identifier': process.env.TB_TUNNEL_IDENTIFIER

      - uses: testingbot/github-actions/report@v1
        if: always()
        with:
          comment-on-pr: true
          fail-on-failure: true
```

## Mobile example

```yaml
      - run: ./gradlew assembleDebug assembleAndroidTest
      - uses: testingbot/github-actions/espresso@v1
        with:
          key: ${{ secrets.TB_KEY }}
          secret: ${{ secrets.TB_SECRET }}
          app: app/build/outputs/apk/debug/app-debug.apk
          test-app: app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
          device: Pixel 8
```

## Why one repository

The actions share their code (API client, GitHub context, build naming, summaries) and are released together, so a `setup-env@v1` always agrees with `report@v1` on the build name and the environment variables. One repository gives one `v1` tag, one CI and one place for issues, the same layout as `browserstack/github-actions`. The repository root also has an `action.yml` (setup-env), which is what the GitHub Marketplace lists; the other actions are used by path (`testingbot/github-actions/report@v1`).

## Development

```sh
npm ci
npm test          # unit tests (mocha + sinon, no network)
npm run lint
npm run build     # bundles every action into <action>/dist with ncc
```

`<action>/dist` is committed, because GitHub runs the actions straight from the repository; CI fails when it is out of date. `npm run test:live` runs the `@live` tests against the real API with `TB_KEY` / `TB_SECRET` set. The [self-test workflow](.github/workflows/self-test.yml) runs every action from the checkout against TestingBot when the repository secrets are present.

Releases: update `CHANGELOG.md`, build, commit, tag `v1.x.y` and move the `v1` tag.

## License

MIT
