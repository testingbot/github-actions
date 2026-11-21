# TestingBot app-upload

Uploads an Android or iOS app to [TestingBot storage](https://testingbot.com/support/app-automate/help/upload) and outputs its `tb://` URL, for the `app` (`appium:app`) capability of your Appium tests.

```yaml
- id: upload
  uses: testingbot/github-actions/app-upload@v1
  with:
    key: ${{ secrets.TB_KEY }}
    secret: ${{ secrets.TB_SECRET }}
    file: app/build/outputs/apk/debug/app-debug.apk
- run: npm run test:appium
  env:
    APP_URL: ${{ steps.upload.outputs.app-url }}   # also in $TESTINGBOT_APP_URL
```

Accepted files: `.apk`, `.aab`, `.ipa` and `.zip` (a zipped `.app` for iOS simulators: `ditto -c -k --keepParent MyApp.app MyApp.zip`). Instead of `file`, `url` lets TestingBot download the app itself.

By default every upload gets a new `tb://` URL. With `app-key: my-app` each upload replaces the binary stored under that name and the URL stays `tb://my-app`, so you can hard-code it in your capabilities.

TestingBot reads the version and platform of the app right after the upload. The action waits for that (`wait-for-processing`) so `app-version` is filled in; the app can be used either way. Uploads are deleted after 62 days.

The [espresso](../espresso) and [xcuitest](../xcuitest) actions upload their apps themselves; you do not need this action for them.

This is the same flow as the Bitrise step [testingbot-upload-app](https://github.com/testingbot/bitrise-step-testingbot-app-upload): `POST /v1/storage` (or `/v1/storage/<app-key>`), then `GET /v1/storage/<app_url>` for the metadata.

## Inputs

| Input | Description | Default |
|---|---|---|
| `key` | TestingBot API key. Falls back to TB_KEY / TESTINGBOT_KEY. |  |
| `secret` | TestingBot API secret. Falls back to TB_SECRET / TESTINGBOT_SECRET. |  |
| `file` | Path to the app file. Zip a .app bundle first. Either this or url. |  |
| `url` | Public URL TestingBot downloads the app from, instead of file. |  |
| `app-key` | Store the app under this name so its URL stays tb://<app-key> across uploads. |  |
| `wait-for-processing` | Wait until TestingBot has read the version and platform, so app-version is filled in. | `true` |
| `processing-timeout` | Seconds to wait for processing. | `300` |

## Outputs

| Output | Description |
|---|---|
| `app-url` | The tb:// app URL, for the app (appium:app) capability. Also exported as TESTINGBOT_APP_URL and TB_APP_URL. |
| `app-id` | Numeric id of the stored app. |
| `app-version` | Version TestingBot read from the app. |
| `app-state` | Processing state: DONE or PROCESSING. |
