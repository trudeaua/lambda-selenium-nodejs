# AR Reports Scraper (lambda-selenium-nodejs)

Selenium WebDriver + Node.js web scraper deployed as a Docker-based AWS Lambda. Scrapes a website for a PDF report, uploads it to Google Drive, and sends email notifications via Gmail API.

## Tech Stack

- **Runtime:** Node.js 20, TypeScript 5
- **Framework:** Serverless Framework v3 (AWS Lambda via Docker/ECR)
- **Build:** esbuild via `esbuild-node-tsc` (`etsc`)
- **Browser:** Selenium WebDriver (Chromium, headless in Docker)
- **Google APIs:** Google Drive, Gmail
- **Region:** ca-central-1

## Project Structure

- `index.ts` — Lambda entry point
- `src/scrape.service.ts` — Web scraping logic (Selenium)
- `src/drive.service.ts` — Google Drive upload
- `src/gmail.service.ts` — Email notifications
- `src/google.service.ts` — Shared Google API auth/client
- `utils/` — Helpers (date formatting, sleep)
- `Dockerfile` — Lambda container image with Chromium
- `scripts/` — Build/deploy scripts (ECR push)

## Commands

- `yarn` — Install dependencies
- `yarn build` — Build with etsc
- `scripts/build.sh` — Build Docker image and push to ECR

## Deployment

Uses Docker images pushed to ECR. Serverless references the ECR image directly:
```
aws ecr create-repository --repository-name <base>-<stage>-<function> ...
scripts/build.sh -a <AWS_ACCOUNT_ID> -e <STAGE> -n <REPO_BASE> -f <FUNCTION> -r <REGION>
yarn sls deploy --stage <STAGE>
```

## Environment Variables

Configured via `.env` and referenced in `serverless.yml`:
- `AUTH_USERNAME` / `AUTH_PASSWORD` — Login credentials for target site
- `LOGIN_URL` — URL to scrape
- `REPORT_FILENAME` / `REPORT_FRIENDLY_NAME` — Report file identification
- `GOOGLE_IMPERSONATE_EMAIL` — Google Workspace user email to impersonate via domain-wide delegation
- Service account key JSON is stored in AWS Secrets Manager (`gmailpubsub/google_token` in ca-central-1)
- `DRIVE_FOLDER_ID` — Target Drive folder
- `TO_EMAIL` / `SUCCESS_CC_EMAILS` / `FAIL_CC_EMAILS` — Notification recipients
- `AWS_ACCOUNT_ID` — For ECR image references

## Notes

- Runs daily at 5:30 PM EST (cron via EventBridge Scheduler, timezone-aware)
- Lambda memory set to 2048 MB to support headless Chromium
- 2048 MB memory allocation is required for Selenium/Chromium
