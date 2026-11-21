# TestingBot report

Fetches a TestingBot build after your tests ran and writes the results to the job summary: a pass/fail line and a table of every session, failed first, with links to the session and its video in TestingBot. Optionally it writes a JUnit file, keeps one comment on the pull request up to date, and fails the step when tests failed.

```yaml
- uses: testingbot/github-actions/setup-env@v1
  with:
    key: ${{ secrets.TB_KEY }}
    secret: ${{ secrets.TB_SECRET }}
- run: npm test            # sessions use build: process.env.TB_BUILD
- uses: testingbot/github-actions/report@v1
  if: always()             # also report when the tests failed
```

Without `build-name` the action reports on `$TB_BUILD` (set by setup-env), and without that on the name setup-env would have picked for this run, so the two always agree.

The build appears in TestingBot with its first session. The action waits up to `wait-timeout` seconds for the build to appear and for running sessions to finish, then reports what it has.

## Example summary

> ### ❌ TestingBot: tests failed
>
> Build [`github-storefront-pr-42-9876543210-1`](https://testingbot.com/members/builds/3568776): **13** passed, **3** failed of 16 tests.
>
> | | Test | Environment | Duration | Links |
> |---|---|---|---|---|
> | ❌ | Calculator matrix | Chrome \| Pixel 8 - 14.0 | 4s | Session · Video |
> | ✅ | Calculator adds two numbers | Chrome \| Pixel 8 - 17.0 | 4s | Session · Video |

Video links are signed download URLs from the API and stop working after a while; the session link always works for members of the account.

## Pull request comment

```yaml
permissions:
  pull-requests: write
...
- uses: testingbot/github-actions/report@v1
  if: always()
  with:
    comment-on-pr: true
```

The comment carries a hidden marker (`comment-tag`, by default the workflow name), so new pushes and re-runs edit the same comment. Two report steps in one workflow need different `comment-tag`s. A failing comment (for example on a fork PR with a read-only token) is a warning, not a failure.

## JUnit and failing the job

```yaml
- uses: testingbot/github-actions/report@v1
  if: always()
  with:
    junit-file: reports/testingbot.xml
    fail-on-failure: true
```

The JUnit file has one test case per session (the environment is the class name), so any JUnit reporter action can turn it into checks or annotations.

## Inputs

| Input | Description | Default |
|---|---|---|
| `key` | TestingBot API key. Falls back to TB_KEY / TESTINGBOT_KEY. |  |
| `secret` | TestingBot API secret. Falls back to TB_SECRET / TESTINGBOT_SECRET. |  |
| `build-name` | Build identifier to report on. Default: $TB_BUILD (set by setup-env), else the setup-env default for this run. |  |
| `wait-timeout` | Seconds to wait for the build to appear and for running tests to finish. | `120` |
| `poll-interval` | Seconds between polls while waiting. | `10` |
| `max-rows` | Maximum number of tests listed in the table (failed first). | `100` |
| `junit-file` | Also write the results as a JUnit XML file at this path. |  |
| `comment-on-pr` | On pull_request events, post (and keep updating) one comment with the results. Needs pull-requests: write. | `false` |
| `comment-tag` | Distinguishes the comments of several report steps on one PR. Default: the workflow name. |  |
| `github-token` | Token for the PR comment. | `${{ github.token }}` |
| `resolve-pr-check` | Tell TestingBot the build is finished so the PR check registered by setup-env (pr-check) resolves. | `false` |
| `fail-on-failure` | Fail this step when a test failed or the build has no tests. | `false` |

## Outputs

| Output | Description |
|---|---|
| `outcome` | passed, failed, running or no-tests. |
| `build-name` | The build identifier reported on. |
| `build-id` | Numeric TestingBot build id (when found among the 100 newest builds). |
| `build-url` | Link to the build in the TestingBot dashboard. |
| `total` | Number of tests in the build. |
| `passed` | Number of passed tests. |
| `failed` | Number of failed tests. |
| `unknown` | Number of tests without a result (or still running). |
| `junit-file` | Absolute path of the JUnit file, when junit-file was set. |
