import fs from "fs";
import os from "os";
import path from "path";
import webdriver, { By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";
import { sleep } from "../utils/sleep";

const REPORT_BODY_ID = "rvMainReportView_ctl13";
const EXPORT_BUTTON_ID = "rvMainReportView_ctl09_ctl04_ctl00";
const EXPORT_MENU_ID = "rvMainReportView_ctl09_ctl04_ctl00_Menu";
const CHROMEDRIVER_LOG_PATH = "/tmp/chromedriver.log";

/** Page state captured when a scrape fails, so the failure email can explain what the browser saw */
export interface ScrapeDiagnostics {
  currentUrl?: string;
  screenshotBase64?: string;
  pageSource?: string;
  chromedriverLog?: string;
  captureErrors?: string[];
}

export class ScrapeService {
  private readonly driver: chrome.Driver;
  private readonly auth: { username: string; password: string };
  private readonly loginUrl: string;
  private readonly reportFilename: string;
  private readonly EL_VISIBLE_TIMEOUT = 120_000;
  /** The export menu opens in well under a second when the click lands, so a long wait only burns Lambda budget */
  private readonly MENU_OPEN_TIMEOUT = 10_000;
  private readonly MENU_CLICK_ATTEMPTS = 3;
  private readonly PAGE_SOURCE_MAX_CHARS = 512_000;
  private readonly LOG_TAIL_MAX_CHARS = 256_000;
  private readonly DEBUG: boolean;

  /**
   * Service for handling web-scraping-related actions such as opening webpages, clicking buttons, and downloading files
   */
  public constructor() {
    this.driver = ScrapeService.initWebDriver();
    this.auth = ScrapeService.getLoginCredentials();
    this.loginUrl = process.env.LOGIN_URL ?? "";
    this.reportFilename = process.env.REPORT_FILENAME ?? "";
    this.DEBUG = true;
  }

  /**
   * Enable headless downloads via CDP
   * Must be called after driver is built, before any downloads
   */
  public async enableDownloads() {
    const downloadDir = ScrapeService.getDownloadDir();
    await this.driver.sendDevToolsCommand("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
      eventsEnabled: true,
    });
  }

  /**
   * Find the PDF export button within the reports menu
   * @param reportsMenu Webdriver element representing Corebridge reports menu
   * @returns PDF report export button
   */
  private static async pdfLink(reportsMenu: webdriver.WebElement) {
    const links = await reportsMenu.findElements(By.css("a"));
    let pdfLinkEl: webdriver.WebElement | null = null;
    for (const link of links) {
      const title = await link.getAttribute("title");
      if (title.toLowerCase() === "pdf") {
        pdfLinkEl = link;
      }
    }
    return pdfLinkEl;
  }

  /**
   * Get Corebridge authentication credentials
   * @returns Corebridge authentication credentials
   */
  private static getLoginCredentials() {
    const auth = {
      username: process.env.AUTH_USERNAME ?? "",
      password: process.env.AUTH_PASSWORD ?? "",
    };

    if (!auth.username || !auth.password) {
      throw new Error("Missing credentials");
    }
    return auth;
  }

  /**
   * Get the system's download directory
   * @returns Directory where file are downloaded
   */
  private static getDownloadDir() {
    const env = process.env.NODE_ENV;
    const isProduction = env === "production";
    if (isProduction) {
      return "/tmp";
    }
    return path.join(os.homedir(), "Downloads");
  }

  /**
   * Create a webdriver instance
   * @returns A webdriver instance running on chrome
   */
  private static initWebDriver() {
    const env = process.env.NODE_ENV;
    const isProduction = env === "production";
    const builder = new webdriver.Builder().forBrowser("chrome");
    const chromeOptions = new chrome.Options();

    let binaryPath: string | undefined;
    let driverPath: string | undefined;

    if (isProduction) {
      binaryPath = "/opt/chrome/chrome-linux64/chrome";
      driverPath = "/opt/chromedriver/chromedriver-linux64/chromedriver";
      if (!fs.existsSync(CHROMEDRIVER_LOG_PATH)) {
        fs.writeFileSync(CHROMEDRIVER_LOG_PATH, "");
      }
      chromeOptions.setChromeLogFile(CHROMEDRIVER_LOG_PATH);
    }

    const service = new chrome.ServiceBuilder(driverPath);

    const flags = [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-dev-tools",
      "--no-zygote",
      "--single-process",
      "--user-data-dir=/tmp/chromium",
      "--data-path=/tmp/data-path",
      "--homedir=/tmp",
      "--disk-cache-dir=/tmp/cache-dir",
    ];
    if (binaryPath) {
      chromeOptions.setChromeBinaryPath(binaryPath);
    }

    const prefs = {
      "profile.default_content_settings.popups": 0,
      "download.default_directory": ScrapeService.getDownloadDir(),
      directory_upgrade: true,
      "plugins.always_open_pdf_externally": true,
    };
    chromeOptions.setUserPreferences(prefs);
    chromeOptions.addArguments(...flags);
    builder.setChromeService(service);
    builder.setChromeOptions(chromeOptions);

    const driver = builder.build() as unknown as chrome.Driver;

    return driver;
  }

  /**
   * Get today's report
   * @returns Buffer of the report file
   */
  public async scrapeReport() {
    await this.step("login", () => this.login());
    const reportsMenu = await this.step("open reports menu", () =>
      this.openReportsMenu()
    );
    await this.step("enable downloads", () => this.enableDownloads());
    await this.step("export pdf report", () => this.exportPdfReport(reportsMenu));

    return this.step("read downloaded report", async () => {
      const downloadDir = ScrapeService.getDownloadDir();
      const files = fs.readdirSync(downloadDir);
      this.debugLog("files in download dir:", downloadDir, files);

      return fs.createReadStream(`${downloadDir}/${this.reportFilename}`);
    });
  }

  /**
   * Capture whatever the browser can still tell us about the page a failed run ended on
   * @description Every capture is independent and best-effort, the driver may already be dead
   * @returns Page state at the time of failure
   */
  public async captureDiagnostics(): Promise<ScrapeDiagnostics> {
    const diagnostics: ScrapeDiagnostics = {};
    const captureErrors: string[] = [];

    await this.tryCapture("currentUrl", captureErrors, async () => {
      diagnostics.currentUrl = await this.driver.getCurrentUrl();
    });
    await this.tryCapture("screenshot", captureErrors, async () => {
      diagnostics.screenshotBase64 = await this.driver.takeScreenshot();
    });
    await this.tryCapture("pageSource", captureErrors, async () => {
      const source = await this.driver.getPageSource();
      diagnostics.pageSource = ScrapeService.truncate(
        source,
        this.PAGE_SOURCE_MAX_CHARS,
        "head"
      );
    });
    await this.tryCapture("chromedriverLog", captureErrors, async () => {
      if (!fs.existsSync(CHROMEDRIVER_LOG_PATH)) {
        return;
      }
      const log = fs.readFileSync(CHROMEDRIVER_LOG_PATH, "utf8");
      diagnostics.chromedriverLog = ScrapeService.truncate(
        log,
        this.LOG_TAIL_MAX_CHARS,
        "tail"
      );
    });

    if (captureErrors.length) {
      diagnostics.captureErrors = captureErrors;
    }

    this.debugLog("captured diagnostics", {
      currentUrl: diagnostics.currentUrl,
      screenshotChars: diagnostics.screenshotBase64?.length ?? 0,
      pageSourceChars: diagnostics.pageSource?.length ?? 0,
      chromedriverLogChars: diagnostics.chromedriverLog?.length ?? 0,
      captureErrors,
    });

    return diagnostics;
  }

  /**
   * Destroy the webdriver session
   */
  public async destroy() {
    await this.driver.quit();
  }

  /**
   * Run a named step, tagging any error it throws with the step name
   * @description A bare TimeoutError says nothing about where the scrape got to
   */
  private async step<T>(name: string, run: () => Promise<T>): Promise<T> {
    this.debugLog(`start: ${name}`);
    try {
      const result = await run();
      this.debugLog(`done: ${name}`);
      return result;
    } catch (e) {
      if (e instanceof Error) {
        e.message = `[${name}] ${e.message}`;
      }
      throw e;
    }
  }

  /**
   * Run a single best-effort diagnostic capture, recording rather than throwing on failure
   */
  private async tryCapture(
    label: string,
    errors: string[],
    run: () => Promise<void>
  ) {
    try {
      await run();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${label}: ${message}`);
      console.error(`failed to capture ${label}`, message);
    }
  }

  /**
   * Trim a value down to a size an email can carry
   */
  private static truncate(
    value: string,
    maxChars: number,
    keep: "head" | "tail"
  ) {
    if (value.length <= maxChars) {
      return value;
    }
    const omitted = value.length - maxChars;
    return keep === "head"
      ? `${value.slice(0, maxChars)}\n...[truncated ${omitted} chars]`
      : `...[truncated ${omitted} chars]\n${value.slice(-maxChars)}`;
  }

  /**
   * Login to the Corebridge site
   */
  private async login() {
    await this.driver.get(this.loginUrl);
    const usernameInput = await this.driver.findElement({ id: "txtUsername" });
    const passwordInput = await this.driver.findElement({ id: "txtPassword" });
    const loginBtn = await this.driver.findElement({ id: "btnLogin" });
    await this.driver.wait(
      until.elementIsVisible(usernameInput),
      this.EL_VISIBLE_TIMEOUT,
    );
    await this.driver.wait(
      until.elementIsVisible(passwordInput),
      this.EL_VISIBLE_TIMEOUT,
    );
    await this.driver.wait(
      until.elementIsVisible(loginBtn),
      this.EL_VISIBLE_TIMEOUT,
    );
    await usernameInput.sendKeys(this.auth.username);
    await passwordInput.sendKeys(this.auth.password);
    await loginBtn.click();
  }

  /**
   * Open the reports menu
   * @description The menu is a JS dropdown that lives in the DOM hidden, so a click that doesn't
   * register looks identical to a click that did until the menu fails to appear. Verify it opened
   * and click again if it didn't.
   * @returns The opened reports menu
   */
  private async openReportsMenu() {
    await this.waitForReportToBeVisible();
    const reportsButton = await this.driver.findElement({
      id: EXPORT_BUTTON_ID,
    });
    await this.driver.wait(
      until.elementIsVisible(reportsButton),
      this.EL_VISIBLE_TIMEOUT,
    );
    await sleep(2000);

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.MENU_CLICK_ATTEMPTS; attempt++) {
      await reportsButton.click();
      try {
        const reportsMenu = await this.driver.findElement({
          id: EXPORT_MENU_ID,
        });
        await this.driver.wait(
          until.elementIsVisible(reportsMenu),
          this.MENU_OPEN_TIMEOUT,
        );
        this.debugLog(`export menu opened on attempt ${attempt}`);
        return reportsMenu;
      } catch (e) {
        lastError = e;
        this.debugLog(
          `export menu did not open on attempt ${attempt}`,
          e instanceof Error ? e.message : e
        );
        await sleep(2000);
      }
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `export menu never became visible after ${this.MENU_CLICK_ATTEMPTS} clicks on #${EXPORT_BUTTON_ID}: ${reason}`
    );
  }

  /**
   * Download the PDF report file
   * @param reportsMenu The already-open reports menu
   */
  private async exportPdfReport(reportsMenu: webdriver.WebElement) {
    const pdfLinkEl = await reportsMenu.findElement(ScrapeService.pdfLink);
    await pdfLinkEl.click();
    await sleep(10000);
  }

  /**
   * Wait for the report to be visible on screen
   * @description Report needs to load and loading dialog shown first, need to wait for report to be visible in order to export
   */
  private async waitForReportToBeVisible() {
    const report = await this.driver.findElement({
      id: REPORT_BODY_ID,
    });
    await this.driver.wait(
      until.elementIsVisible(report),
      this.EL_VISIBLE_TIMEOUT,
    );
    await sleep(2000);
  }

  private debugLog(...obj: any[]) {
    if (this.DEBUG) {
      console.debug(obj);
    }
  }
}
