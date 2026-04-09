# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Selenium WebDriver + Node.js web scraper deployed as a Docker-based AWS Lambda. Scrapes a Corebridge website for a PDF report, uploads it to Google Drive, and sends email notifications via Gmail API. Runs daily at 5:30 PM EST via EventBridge Scheduler.

## Commands

- `yarn` — Install dependencies
- `yarn build` — Build with esbuild-node-tsc (`etsc`), outputs to `dist/`
- `yarn test` — Run Jest tests (23 tests across 7 suites)
- `yarn test -- --testPathPattern=gmail` — Run a single test file by pattern
- `scripts/build.sh -a <ACCOUNT_ID> -e production -n ar-reports-scraper -f main -r ca-central-1` — Build & push Docker image to ECR
- `npx serverless deploy --stage production` — Deploy via Serverless Framework v3

## Architecture

```
index.ts (Lambda handler)
├── ScrapeService — Selenium WebDriver automation (login, navigate, download PDF)
│   └── Uses Chrome DevTools Protocol (CDP) for headless downloads
└── GoogleService — Static factory: GoogleService.create()
    ├── Fetches service account key from AWS Secrets Manager at runtime
    ├── DriveService — Uploads PDF to Google Drive
    └── GmailService — Sends success/failure email notifications
```

**GoogleService uses an async factory pattern** — `GoogleService.create()` fetches credentials from Secrets Manager, initializes JWT auth, then returns an instance. The constructor is private.

**Google auth uses domain-wide delegation** — A GCP service account impersonates a Workspace user (`GOOGLE_IMPERSONATE_EMAIL`) via JWT with scopes `drive` and `gmail.send`.

## Build System

`esbuild-node-tsc` transpiles TypeScript using esbuild with tsconfig.json settings. Despite `"module": "ES2022"` in tsconfig, the output is CommonJS (required for Lambda compatibility). No custom esbuild config exists — it uses defaults.

**Import paths must be relative in source code.** The tsconfig `baseUrl: "."` does NOT create runtime path aliases. Using `import { x } from "utils/foo"` will compile but fail at runtime in Lambda. Always use `"../utils/foo"` style imports. Jest has a `moduleNameMapper` that resolves `utils/*` in tests only.

## Testing

Jest with ts-jest preset. Tests live in `__tests__/` mirroring src structure.

**Key patterns:**
- `jest.mock()` calls must appear BEFORE imports of mocked modules
- External services (googleapis, selenium-webdriver, AWS SDK, fs) are fully mocked
- Tests save/restore `process.env` in beforeEach/afterEach
- `--forceExit` flag is needed due to selenium-webdriver's internal timers

## Chrome / Selenium in Lambda

- Chrome for Testing v131 installed via `scripts/install-chrome.sh` with new download URLs (115+ changed from chromium-browser-snapshots to chrome-for-testing-public)
- Production binary paths: `/opt/chrome/chrome-linux64/chrome` and `/opt/chromedriver/chromedriver-linux64/chromedriver`
- Headless downloads require `Browser.setDownloadBehavior` CDP command after driver starts — Chrome preferences alone don't work in headless mode
- Downloads go to `/tmp` in production, `~/Downloads` locally
- Lambda needs 2048 MB memory for Chromium
- Dockerfile uses AL2023 base image (`dnf` not `yum` for packages)

## Deployment

Docker-based deployment via GitHub Actions (`.github/workflows/deploy.yml`):
1. Push to `main` triggers workflow
2. Jest tests run first
3. Docker image built and pushed to ECR (`ar-reports-scraper-production-main`)
4. `serverless deploy` updates Lambda to use new image

AWS auth uses GitHub OIDC (role-to-assume), not static credentials. Serverless v3 shows a non-blocking warning for `nodejs22.x` runtime — safe to ignore since the actual runtime comes from the Docker image.

## Environment Variables

Three layers:
1. **`.env` file** — Local development, loaded by `dotenv.config()` in index.ts
2. **`serverless.yml`** — Maps env vars to Lambda environment via `${env:VAR_NAME}`
3. **AWS Secrets Manager** — Service account key JSON fetched at runtime by `GoogleService.create()` (secret ID configured via `GOOGLE_SECRET_ID` env var)

See `.env.example` for the full list of required variables.
