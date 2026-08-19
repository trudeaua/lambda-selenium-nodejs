# lambda-selenium-nodejs

A Selenium WebDriver + Node.js scraper that runs as a Docker-based AWS Lambda. It logs into a Corebridge website, downloads a PDF report, uploads it to Google Drive, and emails a notification via Gmail. Deployed with the Serverless Framework and triggered daily by AWS EventBridge Scheduler.

## Background & purpose

The report this scrapes isn't available through any API, only through a web UI that requires an authenticated session and a report viewer that renders the PDF client-side. This project automates that flow headlessly so the report shows up in Google Drive and an inbox every day without anyone logging in manually.

Because there's no real API to hit, the scraper drives an actual (headless) Chrome browser through Selenium: log in, navigate to the report viewer, trigger the download, and pull the file out of the browser's download directory via the Chrome DevTools Protocol. Lambda's read-only filesystem and lack of a persistent Chrome install are why this ships as a Docker image with Chrome and Chromedriver baked in, rather than a plain zip-based Lambda.

## Requirements

**System (local development):**

- Node.js 22.x
- Yarn (classic)
- Docker (for building the deployable image and for `serverless-offline` container-based testing)
- AWS CLI, configured with credentials for the target account/region
- Optional, for running the scrape locally outside Docker: a Chrome/Chromium binary and matching Chromedriver on your `PATH` (see `scripts/install-chrome.sh` for the version pinned in the Lambda image)

**Accounts / access:**

- AWS account with permissions to manage Lambda, ECR, EventBridge Scheduler, IAM, and Secrets Manager (`ca-central-1` by default)
- A GCP service account with domain-wide delegation enabled, impersonating a Google Workspace user, with the `drive` and `gmail.send` scopes
- Credentials for the Corebridge site being scraped

**Environment variables** — see `.env.example` for the full list. Notable ones:

- `AUTH_USERNAME`, `AUTH_PASSWORD`, `LOGIN_URL` — Corebridge login
- `REPORT_FILENAME`, `REPORT_FRIENDLY_NAME` — which file to grab and how to refer to it in emails
- `GOOGLE_SECRET_ID` — AWS Secrets Manager secret ID holding the GCP service account key JSON
- `GOOGLE_IMPERSONATE_EMAIL` — Workspace user the service account impersonates
- `DRIVE_FOLDER_ID` — destination folder for the uploaded report
- `TO_EMAIL`, `SUCCESS_CC_EMAILS`, `FAIL_CC_EMAILS` — notification recipients
- `TZ` — timezone used for date formatting in filenames/emails
- `AWS_ACCOUNT_ID` — used by `scripts/build.sh` to build the ECR image URI

## Project overview

```
index.ts (Lambda handler)
├── ScrapeService (src/scrape.service.ts)
│   Drives headless Chrome via Selenium: logs into Corebridge, waits for the
│   report viewer to render, triggers the download, and polls the download
│   directory for the file. Uses the Chrome DevTools Protocol
│   (Browser.setDownloadBehavior) because headless Chrome ignores normal
│   download preferences. Also captures diagnostics (screenshot, page
│   source, chromedriver log) on failure so the failure email is
│   debuggable without SSH access to a Lambda.
│
└── GoogleService (src/google.service.ts)
    Async factory (GoogleService.create()) that pulls the GCP service
    account key from AWS Secrets Manager at runtime, builds a JWT client
    with domain-wide delegation, and exposes uploadReport /
    sendFailureNotification.
    ├── DriveService (src/drive.service.ts) — uploads the PDF to a Drive folder
    └── GmailService (src/gmail.service.ts) — sends success/failure emails,
        including diagnostic attachments on failure

utils/
├── sleep.ts        — promise-based delay helper
└── formatDate.ts    — dayjs-based date formatting for filenames/emails
```

The handler (`index.ts`) wires these together: scrape the report, hand it to `GoogleService` to upload and notify on success, or capture diagnostics and send a failure email if the scrape throws. The WebDriver is always torn down in a `finally` block regardless of outcome.

Chrome and Chromedriver are not npm packages — they're installed into the Docker image by `scripts/install-chrome.sh` from Chrome for Testing builds, and live at `/opt/chrome` and `/opt/chromedriver` in the running container.

## Local development

1. Install dependencies:
   ```
   yarn
   ```
2. Copy `.env.example` to `.env` and fill in real values (loaded automatically via `dotenv` in `index.ts`).
3. For local Google API testing outside of Secrets Manager, `scripts/local-auth.js` runs an OAuth installed-app flow instead of the service-account JWT flow used in Lambda. It expects a `credentials.json` (OAuth client) in the project root and writes `token.json` on success:
   ```
   node scripts/local-auth.js
   ```
   This is a convenience for exercising the Drive/Gmail APIs directly; it is not used by the Lambda handler itself, which always authenticates via the service account key in Secrets Manager.
4. Run the test suite:
   ```
   yarn test
   ```
   Runs Jest with `--forceExit` (selenium-webdriver leaves internal timers running that would otherwise hang the process). To run a single suite:
   ```
   yarn test -- --testPathPattern=gmail
   ```
5. To exercise the scraper itself locally (outside Lambda), you'll need a Chrome binary and matching Chromedriver on your `PATH` — downloads land in `~/Downloads` locally vs. `/tmp` in Lambda. There's no local invoke script checked in; the handler in `index.ts` can be run directly with `ts-node` or invoked via `serverless-offline` if you want to simulate the Lambda event shape.

### Build

```
yarn build
```

Transpiles TypeScript with `esbuild-node-tsc` into `dist/`. The output is CommonJS despite `"module": "ES2022"` in `tsconfig.json` — Lambda's Node runtime needs CommonJS, and esbuild controls the actual output format here regardless of that tsconfig setting.

Note: import paths must be relative (`"../utils/foo"`), not path-mapped (`"utils/foo"`) — `baseUrl` in `tsconfig.json` doesn't produce a runtime alias outside of Jest, where `moduleNameMapper` resolves it.

## Deployment

Deployment is Docker-based: the built app, Chrome, and Chromedriver all ship inside one image that Lambda runs as a container.

**Automatic (CI):** pushing to `main` triggers `.github/workflows/deploy.yml`, which:

1. Runs `yarn test`
2. Builds the Docker image and pushes it to ECR (`ar-reports-scraper-production-main`)
3. Runs `npx serverless deploy --stage production` to point the Lambda at the new image

AWS auth in CI uses GitHub OIDC (`role-to-assume`), not static credentials.

**Manual:**

1. Create the ECR repository once, if it doesn't exist yet (name format matters — Serverless expects `<name>-<stage>-<function>` to auto-detect the repo):
   ```
   aws ecr create-repository --repository-name ar-reports-scraper-production-main --image-scanning-configuration scanOnPush=true --image-tag-mutability MUTABLE
   ```
2. Build and push the image:
   ```
   scripts/build.sh -a <AWS_ACCOUNT_ID> -e production -n ar-reports-scraper -f main -r ca-central-1
   ```
3. Deploy:
   ```
   npx serverless deploy --stage production
   ```

Serverless v3 prints a non-blocking warning about the `nodejs22.x` runtime — safe to ignore, since the actual runtime is whatever's in the Docker image, not the Lambda config.

### Scheduling

The function is triggered by EventBridge Scheduler (configured under `functions.main.events.schedule` in `serverless.yml`), using a `cron(...)` expression evaluated against an explicit IANA `timezone` — this is what makes the daily run land at the same local wall-clock time year-round without any DST-related app logic.

### Environment variables in deployment

- `.env` — local development only, loaded by `dotenv.config()`
- `serverless.yml` — maps `${env:VAR_NAME}` into the Lambda's environment for both manual and CI deploys
- AWS Secrets Manager — the Google service account key JSON, fetched at runtime by `GoogleService.create()` using the secret ID in `GOOGLE_SECRET_ID`
- GitHub Actions secrets/variables — CI supplies the same variables to `serverless deploy` via repo secrets (credentials) and repo variables (non-sensitive config)
