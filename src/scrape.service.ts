import fs from "fs";
import os from "os";
import path from "path";
import webdriver, { By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";
import { sleep } from "../utils/sleep";

export class ScrapeService {
  private readonly driver: webdriver.ThenableWebDriver;
  private readonly auth: { username: string; password: string };
  private readonly loginUrl: string;
  private readonly reportFilename: string;
  private readonly EL_VISIBLE_TIMEOUT = 120_000;
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
      binaryPath = "/opt/chromium/chrome";
      driverPath = "/opt/chromedriver/chromedriver";
      if (!fs.existsSync("/tmp/chromedriver.log")) {
        fs.writeFileSync("/tmp/chromedriver.log", "");
      }
      chromeOptions.setChromeLogFile("/tmp/chromedriver.log");
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
    };
    chromeOptions.setUserPreferences(prefs);
    chromeOptions.addArguments(...flags);
    builder.setChromeService(service);
    builder.setChromeOptions(chromeOptions);

    const driver = builder.build();

    return driver;
  }

  /**
   * Get today's report
   * @returns Buffer of the report file
   */
  public async scrapeReport() {
    this.debugLog("logging in");
    await this.login();
    this.debugLog("logged in");

    this.debugLog("opening menu");
    await this.openReportsMenu();
    this.debugLog("opened menu");

    this.debugLog("exporting report");
    await this.exportPdfReport();
    this.debugLog("exported report");

    const stream = fs.createReadStream(
      `${ScrapeService.getDownloadDir()}/${this.reportFilename}`
    );
    return stream;
  }

  /**
   * Destroy the webdriver session
   */
  public async destroy() {
    await this.driver.quit();
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
      this.EL_VISIBLE_TIMEOUT
    );
    await this.driver.wait(
      until.elementIsVisible(passwordInput),
      this.EL_VISIBLE_TIMEOUT
    );
    await this.driver.wait(
      until.elementIsVisible(loginBtn),
      this.EL_VISIBLE_TIMEOUT
    );
    await usernameInput.sendKeys(this.auth.username);
    await passwordInput.sendKeys(this.auth.password);
    await loginBtn.click();
  }

  /**
   * Open the reports menu
   */
  private async openReportsMenu() {
    await this.waitForReportToBeVisible();
    const reportsButton = await this.driver.findElement({
      id: "rvMainReportView_ctl09_ctl04_ctl00",
    });
    await this.driver.wait(
      until.elementIsVisible(reportsButton),
      this.EL_VISIBLE_TIMEOUT
    );
    await sleep(2000);
    await reportsButton.click();
  }

  /**
   * Download the PDF report file
   */
  private async exportPdfReport() {
    const reportsMenu = await this.driver.findElement({
      id: "rvMainReportView_ctl09_ctl04_ctl00_Menu",
    });
    await this.driver.wait(
      until.elementIsVisible(reportsMenu),
      this.EL_VISIBLE_TIMEOUT
    );
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
      id: "rvMainReportView_ctl13",
    });
    await this.driver.wait(
      until.elementIsVisible(report),
      this.EL_VISIBLE_TIMEOUT
    );
    await sleep(2000);
  }

  private debugLog(...obj: any[]) {
    if (this.DEBUG) {
      console.debug(obj);
    }
  }
}
