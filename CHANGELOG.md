# Changelog

## 1.0.0 (unreleased)

- `setup-env`: exports `TB_KEY`/`TB_SECRET`, `TESTINGBOT_KEY`/`TESTINGBOT_SECRET`, `TB_BUILD`/`TESTINGBOT_BUILD` and `TB_TUNNEL_IDENTIFIER`/`TESTINGBOT_TUNNEL_IDENTIFIER`; build name templates; optional PR check registration.
- `report`: job summary for a TestingBot build, JUnit file, sticky PR comment, PR check resolution, fail-on-failure.
- `app-upload`: upload to TestingBot storage, stable `app-key`, metadata outputs.
- `espresso` and `xcuitest`: run suites with `@testingbot/cli`, merged JUnit, job summary, per-test annotations.
