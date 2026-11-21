# TestingBot setup-env

Exports your TestingBot credentials, a build name and a tunnel identifier as environment variables, so every later step (your test runner, the [tunnel action](https://github.com/testingbot/testingbot-tunnel-action), the [report](../report) action) uses the same values without repeating them.

```yaml
- uses: testingbot/github-actions/setup-env@v1
  with:
    key: ${{ secrets.TB_KEY }}
    secret: ${{ secrets.TB_SECRET }}
```

## Environment variables

TestingBot tools do not all read the same names, so each value is exported under both:

| Value | Exported as | Read by |
|---|---|---|
| API key | `TB_KEY`, `TESTINGBOT_KEY` | `TB_KEY`: the `testingbot` CLI, testingbot-tunnel-launcher, the TestCafe provider, the GitHub Actions docs samples. `TESTINGBOT_KEY`: the tunnel itself, the Nightwatch/Jest samples, mobilewright-testingbot, the Jenkins, Buildkite and GitLab docs |
| API secret | `TB_SECRET`, `TESTINGBOT_SECRET` | as above |
| Build name | `TB_BUILD`, `TESTINGBOT_BUILD` | your `build` capability (`TB_BUILD` in the docs samples and the TestCafe provider, `TESTINGBOT_BUILD` in mobilewright-testingbot, Buildkite, CodePipeline and Bitrise) |
| Tunnel identifier | `TB_TUNNEL_IDENTIFIER`, `TESTINGBOT_TUNNEL_IDENTIFIER` | your `tunnel-identifier` capability and the tunnel action's `tunnelIdentifier` input |

Set `export-credentials: false` to export only the build name and tunnel identifier.

The values are masked in the log. Use them in your capabilities:

```js
'tb:options': {
  key: process.env.TB_KEY,
  secret: process.env.TB_SECRET,
  build: process.env.TB_BUILD,
  'tunnel-identifier': process.env.TB_TUNNEL_IDENTIFIER
}
```

## Build name

By default there is one TestingBot build per workflow run attempt: every job and matrix leg of the run lands in the same build, and a re-run gets a new one. The default is URL-path safe (`github-storefront-pr-42-9876543210-1`, or `github-storefront-main-9876543210-1` on a push), so it can go straight into `https://api.testingbot.com/v1/builds/$TB_BUILD`.

Pass `build-name` for your own format. Placeholders: `{repo}`, `{repository}` (owner/repo), `{workflow}`, `{job}`, `{run_id}`, `{run_number}`, `{attempt}`, `{ref}` (`pr-42` or the branch slug), `{pr}`, `{branch}`, `{sha}` (7 characters, the PR head on pull requests).

```yaml
    build-name: '{repo} {ref} #{run_number}'
```

## Tunnel identifier

A tunnel runs on one runner, so the default identifier is unique per job: `github-<run_id>-<attempt>-<job>-<random>`. Matrix legs of the same job each get their own, so sessions never go through the tunnel of another leg. Pass it on to the tunnel action:

```yaml
- uses: testingbot/github-actions/setup-env@v1
  with:
    key: ${{ secrets.TB_KEY }}
    secret: ${{ secrets.TB_SECRET }}
- uses: testingbot/testingbot-tunnel-action@v2
  with:
    key: ${{ secrets.TB_KEY }}
    secret: ${{ secrets.TB_SECRET }}
    tunnelIdentifier: ${{ env.TB_TUNNEL_IDENTIFIER }}
```

## Pull request check

With `pr-check: true`, on `pull_request` events setup-env registers the build with TestingBot (`POST /v1/builds/:build/ci`) against the PR head commit, and the [TestingBot GitHub App](https://testingbot.com/support/integrations/ci-cd/github-pr-checks) shows an in-progress **TestingBot / tests** check. Set `resolve-pr-check: true` on the report action to resolve it when the tests are done. The App must be installed on the repository. Registration failures are warnings and never fail the job.

## Inputs

| Input | Description | Default |
|---|---|---|
| `key` | TestingBot API key. Falls back to the TB_KEY / TESTINGBOT_KEY environment variable. |  |
| `secret` | TestingBot API secret. Falls back to TB_SECRET / TESTINGBOT_SECRET. |  |
| `build-name` | Build name (the `build` capability). Placeholders: {repo} {repository} {workflow} {job} {run_id} {run_number} {attempt} {ref} {pr} {branch} {sha}. Default: github-{repo}-{ref}-{run_id}-{attempt}. |  |
| `tunnel-identifier` | Tunnel identifier. Default: github-<run_id>-<attempt>-<job>-<random>, unique per job. |  |
| `export-credentials` | Export TB_KEY, TB_SECRET, TESTINGBOT_KEY and TESTINGBOT_SECRET for later steps. | `true` |
| `pr-check` | On pull_request events, register the build with TestingBot so the TestingBot GitHub App posts a "TestingBot / tests" check. Pair with resolve-pr-check on the report action. | `false` |

## Outputs

| Output | Description |
|---|---|
| `build-name` | The build name, also exported as TB_BUILD and TESTINGBOT_BUILD. |
| `tunnel-identifier` | The tunnel identifier, also exported as TB_TUNNEL_IDENTIFIER and TESTINGBOT_TUNNEL_IDENTIFIER. |
