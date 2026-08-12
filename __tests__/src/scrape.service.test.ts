const mockGet = jest.fn();
const mockFindElement = jest.fn();
const mockWait = jest.fn();
const mockQuit = jest.fn();
const mockBuild = jest.fn();
const mockTakeScreenshot = jest.fn();
const mockGetPageSource = jest.fn();
const mockGetCurrentUrl = jest.fn();
const mockElementIsVisible = jest.fn((element: unknown) => ({ element }));

jest.mock("selenium-webdriver", () => {
  const actual = jest.requireActual("selenium-webdriver");
  return {
    ...actual,
    __esModule: true,
    default: {
      Builder: jest.fn(() => ({
        forBrowser: jest.fn().mockReturnThis(),
        setChromeService: jest.fn().mockReturnThis(),
        setChromeOptions: jest.fn().mockReturnThis(),
        build: mockBuild,
      })),
    },
    By: actual.By,
    until: {
      elementIsVisible: mockElementIsVisible,
    },
  };
});

jest.mock("selenium-webdriver/chrome", () => ({
  Options: jest.fn(() => ({
    setChromeBinaryPath: jest.fn(),
    setChromeLogFile: jest.fn(),
    setUserPreferences: jest.fn(),
    addArguments: jest.fn(),
  })),
  ServiceBuilder: jest.fn(() => ({})),
}));

jest.mock("../../utils/sleep", () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => true),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => "chromedriver log contents"),
  createReadStream: jest.fn(() => "mock-stream"),
  readdirSync: jest.fn(() => ["report.pdf"]),
}));

import fs from "fs";
import { ScrapeService } from "../../src/scrape.service";

const EXPORT_BUTTON_ID = "rvMainReportView_ctl09_ctl04_ctl00";
const EXPORT_MENU_ID = "rvMainReportView_ctl09_ctl04_ctl00_Menu";

interface MockElement {
  id: string;
  sendKeys: jest.Mock;
  click: jest.Mock;
  getAttribute: jest.Mock;
  findElements: jest.Mock;
  findElement: jest.Mock;
}

describe("ScrapeService", () => {
  const originalEnv = process.env;
  let elementsById: Record<string, MockElement>;

  const element = (id: string): MockElement => {
    if (!elementsById[id]) {
      elementsById[id] = {
        id,
        sendKeys: jest.fn(),
        click: jest.fn(),
        getAttribute: jest.fn(),
        findElements: jest.fn(),
        findElement: jest.fn(),
      };
    }
    return elementsById[id];
  };

  /** Condition objects handed to driver.wait carry the element they were built from */
  const waitedOn = (condition: unknown) =>
    (condition as { element?: MockElement })?.element?.id;

  beforeEach(() => {
    jest.clearAllMocks();
    elementsById = {};
    process.env = {
      ...originalEnv,
      AUTH_USERNAME: "testuser",
      AUTH_PASSWORD: "testpass",
      LOGIN_URL: "https://example.com/login",
      REPORT_FILENAME: "report.pdf",
      NODE_ENV: "development",
    };

    mockBuild.mockReturnValue({
      get: mockGet,
      findElement: mockFindElement,
      wait: mockWait,
      quit: mockQuit,
      takeScreenshot: mockTakeScreenshot,
      getPageSource: mockGetPageSource,
      getCurrentUrl: mockGetCurrentUrl,
      sendDevToolsCommand: jest.fn().mockResolvedValue(undefined),
    });

    mockFindElement.mockImplementation(async (locator: { id: string }) =>
      element(locator.id)
    );
    mockWait.mockResolvedValue(undefined);
    mockGet.mockResolvedValue(undefined);
    element(EXPORT_MENU_ID).findElement.mockResolvedValue({ click: jest.fn() });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should throw if credentials are missing", () => {
      delete process.env.AUTH_USERNAME;
      delete process.env.AUTH_PASSWORD;

      expect(() => new ScrapeService()).toThrow("Missing credentials");
    });

    it("should initialize with valid credentials", () => {
      const service = new ScrapeService();
      expect(service).toBeDefined();
    });
  });

  describe("scrapeReport", () => {
    it("should login, open menu, export, and return a read stream", async () => {
      const service = new ScrapeService();
      const result = await service.scrapeReport();

      expect(mockGet).toHaveBeenCalledWith("https://example.com/login");
      expect(result).toBe("mock-stream");
    });

    it("should click the export button once when the menu opens right away", async () => {
      const service = new ScrapeService();
      await service.scrapeReport();

      expect(element(EXPORT_BUTTON_ID).click).toHaveBeenCalledTimes(1);
    });

    it("should re-click the export button until the menu becomes visible", async () => {
      let menuChecks = 0;
      mockWait.mockImplementation(async (condition: unknown) => {
        if (waitedOn(condition) === EXPORT_MENU_ID) {
          menuChecks += 1;
          if (menuChecks < 3) {
            throw new Error("Waiting until element is visible\nWait timed out");
          }
        }
      });

      const service = new ScrapeService();
      const result = await service.scrapeReport();

      expect(element(EXPORT_BUTTON_ID).click).toHaveBeenCalledTimes(3);
      expect(result).toBe("mock-stream");
    });

    it("should throw a descriptive error when the menu never opens", async () => {
      mockWait.mockImplementation(async (condition: unknown) => {
        if (waitedOn(condition) === EXPORT_MENU_ID) {
          throw new Error("Waiting until element is visible\nWait timed out");
        }
      });

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        /export menu never became visible after 3 clicks/
      );
      expect(element(EXPORT_BUTTON_ID).click).toHaveBeenCalledTimes(3);
    });

    it("should wait a short timeout on the menu, not the full element timeout", async () => {
      const service = new ScrapeService();
      await service.scrapeReport();

      const menuWait = mockWait.mock.calls.find(
        (call) => waitedOn(call[0]) === EXPORT_MENU_ID
      );
      expect(menuWait?.[1]).toBe(10_000);
    });

    it("should name the failing step in the error message", async () => {
      mockGet.mockRejectedValue(new Error("connection refused"));

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        "[login] connection refused"
      );
    });
  });

  describe("captureDiagnostics", () => {
    it("should collect url, screenshot, page source, and chromedriver log", async () => {
      mockGetCurrentUrl.mockResolvedValue("https://example.com/reports");
      mockTakeScreenshot.mockResolvedValue("c2NyZWVuc2hvdA==");
      mockGetPageSource.mockResolvedValue("<html>report</html>");

      const service = new ScrapeService();
      const diagnostics = await service.captureDiagnostics();

      expect(diagnostics).toEqual({
        currentUrl: "https://example.com/reports",
        screenshotBase64: "c2NyZWVuc2hvdA==",
        pageSource: "<html>report</html>",
        chromedriverLog: "chromedriver log contents",
      });
    });

    it("should record capture failures instead of throwing", async () => {
      mockGetCurrentUrl.mockRejectedValue(new Error("session deleted"));
      mockTakeScreenshot.mockRejectedValue(new Error("no such window"));
      mockGetPageSource.mockResolvedValue("<html></html>");

      const service = new ScrapeService();
      const diagnostics = await service.captureDiagnostics();

      expect(diagnostics.currentUrl).toBeUndefined();
      expect(diagnostics.screenshotBase64).toBeUndefined();
      expect(diagnostics.pageSource).toBe("<html></html>");
      expect(diagnostics.captureErrors).toEqual([
        "currentUrl: session deleted",
        "screenshot: no such window",
      ]);
    });

    it("should skip the chromedriver log when the file is absent", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockGetCurrentUrl.mockResolvedValue("https://example.com");
      mockTakeScreenshot.mockResolvedValue("shot");
      mockGetPageSource.mockResolvedValue("<html></html>");

      const service = new ScrapeService();
      const diagnostics = await service.captureDiagnostics();

      expect(diagnostics.chromedriverLog).toBeUndefined();
      expect(diagnostics.captureErrors).toBeUndefined();
    });

    it("should truncate an oversized page source", async () => {
      mockGetCurrentUrl.mockResolvedValue("https://example.com");
      mockTakeScreenshot.mockResolvedValue("shot");
      mockGetPageSource.mockResolvedValue("x".repeat(600_000));

      const service = new ScrapeService();
      const diagnostics = await service.captureDiagnostics();

      expect(diagnostics.pageSource).toContain("[truncated 88000 chars]");
      expect(diagnostics.pageSource!.length).toBeLessThan(600_000);
    });
  });

  describe("destroy", () => {
    it("should quit the webdriver", async () => {
      const service = new ScrapeService();
      await service.destroy();
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });
  });
});
