const mockGet = jest.fn();
const mockFindElement = jest.fn();
const mockWait = jest.fn();
const mockQuit = jest.fn();
const mockBuild = jest.fn();
const mockExecuteScript = jest.fn();
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
  sleep: jest.fn(),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => "chromedriver log contents"),
  createReadStream: jest.fn(() => "mock-stream"),
  readdirSync: jest.fn(() => []),
}));

import fs from "fs";
import os from "os";
import path from "path";
import { ScrapeService } from "../../src/scrape.service";
import { sleep } from "../../utils/sleep";

const CHROMEDRIVER_LOG = "/tmp/chromedriver.log";
const POLL_INTERVAL = 500;

describe("ScrapeService", () => {
  const originalEnv = process.env;
  const reportPath = path.join(os.homedir(), "Downloads", "report.pdf");
  const partialPath = `${reportPath}.crdownload`;

  /** Files the mocked fs reports as existing */
  let presentFiles: Set<string>;
  /** Virtual clock so polling doesn't wait in real time */
  let now: number;
  /** Readiness values returned in order, then "ready" forever */
  let readinessStates: string[];

  const exportCalls = () =>
    mockExecuteScript.mock.calls.filter(([script]) =>
      String(script).includes("exportReport")
    );

  const readinessCalls = () =>
    mockExecuteScript.mock.calls.filter(
      ([script]) => !String(script).includes("exportReport")
    );

  /** Report becomes ready only after the queued states are exhausted */
  const queueReadiness = (states: string[]) => {
    readinessStates = [...states];
    mockExecuteScript.mockImplementation(async (script: string) => {
      if (script.includes("exportReport")) {
        presentFiles.add(reportPath);
        return "ok";
      }
      return readinessStates.shift() ?? "ready";
    });
  };

  const mockElement = {
    sendKeys: jest.fn(),
    click: jest.fn(),
    findElement: jest.fn(),
    findElements: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    presentFiles = new Set();
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);

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
      executeScript: mockExecuteScript,
      takeScreenshot: mockTakeScreenshot,
      getPageSource: mockGetPageSource,
      getCurrentUrl: mockGetCurrentUrl,
      sendDevToolsCommand: jest.fn().mockResolvedValue(undefined),
    });

    mockGet.mockResolvedValue(undefined);
    mockWait.mockResolvedValue(undefined);
    mockFindElement.mockResolvedValue(mockElement);

    // executeScript serves two scripts: the readiness poll and the export trigger.
    // By default the report is ready and the download lands immediately.
    mockExecuteScript.mockImplementation(async (script: string) => {
      if (script.includes("exportReport")) {
        presentFiles.add(reportPath);
        return "ok";
      }
      return "ready";
    });

    readinessStates = [];

    (sleep as jest.Mock).mockImplementation(async (ms: number) => {
      now += ms;
    });
    (fs.existsSync as jest.Mock).mockImplementation((p: string) =>
      presentFiles.has(String(p))
    );
    (fs.statSync as jest.Mock).mockImplementation(() => ({ size: 50_000 }));
    (fs.unlinkSync as jest.Mock).mockImplementation((p: string) => {
      presentFiles.delete(String(p));
    });
    (fs.readdirSync as jest.Mock).mockImplementation(() => [...presentFiles]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    it("should login, export, and return a read stream", async () => {
      const service = new ScrapeService();
      const result = await service.scrapeReport();

      expect(mockGet).toHaveBeenCalledWith("https://example.com/login");
      expect(fs.createReadStream).toHaveBeenCalledWith(reportPath);
      expect(result).toBe("mock-stream");
    });

    it("should trigger the export through the viewer's exportReport method", async () => {
      const service = new ScrapeService();
      await service.scrapeReport();

      expect(exportCalls()).toHaveLength(1);
      const [script, viewerId] = exportCalls()[0];
      expect(script).toContain("exportReport");
      expect(script).toContain('viewer.exportReport("PDF")');
      expect(viewerId).toBe("rvMainReportView");
    });

    it("should never look up the export dropdown", async () => {
      const service = new ScrapeService();
      await service.scrapeReport();

      const lookedUpIds = mockFindElement.mock.calls.map((call) => call[0]?.id);
      expect(lookedUpIds).not.toContain("rvMainReportView_ctl09_ctl04_ctl00");
      expect(lookedUpIds).not.toContain(
        "rvMainReportView_ctl09_ctl04_ctl00_Menu"
      );
    });

    it("should check readiness before exporting", async () => {
      const service = new ScrapeService();
      await service.scrapeReport();

      const [script, contentId, overlayId] = readinessCalls()[0];
      expect(script).toContain("isInAsyncPostBack");
      expect(script).toContain("getComputedStyle");
      expect(contentId).toBe("VisibleReportContentrvMainReportView_ctl13");
      expect(overlayId).toBe("rvMainReportView_AsyncWait");
      expect(exportCalls()).toHaveLength(1);
    });

    it("should not wait on the ctl13 scroll container", async () => {
      const service = new ScrapeService();
      await service.scrapeReport();

      const lookedUpIds = mockFindElement.mock.calls.map((call) => call[0]?.id);
      expect(lookedUpIds).not.toContain("rvMainReportView_ctl13");
    });

    it("should throw when the viewer component is missing", async () => {
      mockExecuteScript.mockImplementation(async (script: string) =>
        script.includes("exportReport")
          ? "report viewer component rvMainReportView not found"
          : "ready"
      );

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        "[export pdf report] could not trigger the PDF export: report viewer component rvMainReportView not found"
      );
    });

    it("should throw when the viewer has no exportReport method", async () => {
      mockExecuteScript.mockImplementation(async (script: string) =>
        script.includes("exportReport") ? "viewer has no exportReport method" : "ready"
      );

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        /viewer has no exportReport method/
      );
    });

    it("should name the failing step in the error message", async () => {
      mockGet.mockRejectedValue(new Error("connection refused"));

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        "[login] connection refused"
      );
    });
  });

  describe("waiting for the report to render", () => {
    it("should poll until the viewer reports ready", async () => {
      queueReadiness([
        "loading overlay still showing",
        "async postback in progress",
        "report content empty",
      ]);

      const service = new ScrapeService();
      await service.scrapeReport();

      expect(readinessCalls()).toHaveLength(4);
      expect(
        readinessCalls().length && exportCalls()[0]
      ).toBeDefined();
    });

    it("should not export until the report is ready", async () => {
      queueReadiness(["loading overlay still showing"]);

      const service = new ScrapeService();
      await service.scrapeReport();

      const lastReadiness = mockExecuteScript.mock.calls
        .map(([script]) => String(script))
        .lastIndexOf(readinessCalls()[0][0] as string);
      const exportIndex = mockExecuteScript.mock.calls.findIndex(([script]) =>
        String(script).includes("exportReport")
      );
      expect(lastReadiness).toBeLessThan(exportIndex);
    });

    it("should report the last state when the report never renders", async () => {
      mockExecuteScript.mockImplementation(async (script: string) =>
        script.includes("exportReport") ? "ok" : "loading overlay still showing"
      );

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        "[export pdf report] report did not finish rendering within 120000ms (last state: loading overlay still showing)"
      );
      expect(exportCalls()).toHaveLength(0);
    });
  });

  describe("busy viewer", () => {
    const busyError = () =>
      new Error(
        "javascript error: Sys.InvalidOperationException: The report or page is being updated. Please wait for the current action to complete."
      );

    it("should retry the export when the viewer is mid-postback", async () => {
      let exportAttempts = 0;
      mockExecuteScript.mockImplementation(async (script: string) => {
        if (!script.includes("exportReport")) {
          return "ready";
        }
        exportAttempts += 1;
        if (exportAttempts < 3) {
          throw busyError();
        }
        presentFiles.add(reportPath);
        return "ok";
      });

      const service = new ScrapeService();
      const result = await service.scrapeReport();

      expect(exportAttempts).toBe(3);
      expect(result).toBe("mock-stream");
    });

    it("should give up after the export attempt limit", async () => {
      mockExecuteScript.mockImplementation(async (script: string) => {
        if (!script.includes("exportReport")) {
          return "ready";
        }
        throw busyError();
      });

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        /being updated/
      );
      expect(exportCalls()).toHaveLength(3);
    });

    it("should not retry errors unrelated to the viewer being busy", async () => {
      mockExecuteScript.mockImplementation(async (script: string) => {
        if (!script.includes("exportReport")) {
          return "ready";
        }
        throw new Error("javascript error: $find is not defined");
      });

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        "$find is not defined"
      );
      expect(exportCalls()).toHaveLength(1);
    });
  });

  describe("stale report handling", () => {
    it("should delete a report left by an earlier run before exporting", async () => {
      presentFiles.add(reportPath);

      const service = new ScrapeService();
      await service.scrapeReport();

      expect(fs.unlinkSync).toHaveBeenCalledWith(reportPath);
      expect((fs.unlinkSync as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        mockExecuteScript.mock.invocationCallOrder[0]
      );
    });

    it("should not delete anything when no earlier report exists", async () => {
      const service = new ScrapeService();
      await service.scrapeReport();

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("should fail rather than reuse a stale report when the export downloads nothing", async () => {
      presentFiles.add(reportPath);
      mockExecuteScript.mockImplementation(async (script: string) =>
        script.includes("exportReport") ? "ok" : "ready"
      );

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        /report did not download to/
      );
    });
  });

  describe("waiting for the download", () => {
    it("should poll until the file appears", async () => {
      let polls = 0;
      mockExecuteScript.mockImplementation(async (script: string) =>
        script.includes("exportReport") ? "ok" : "ready"
      );
      (sleep as jest.Mock).mockImplementation(async (ms: number) => {
        now += ms;
        if (ms === POLL_INTERVAL) {
          polls += 1;
          if (polls === 3) {
            presentFiles.add(reportPath);
          }
        }
      });

      const service = new ScrapeService();
      const result = await service.scrapeReport();

      expect(polls).toBe(3);
      expect(result).toBe("mock-stream");
    });

    it("should keep waiting while a .crdownload partial is present", async () => {
      let polls = 0;
      mockExecuteScript.mockImplementation(async (script: string) => {
        if (!script.includes("exportReport")) {
          return "ready";
        }
        presentFiles.add(reportPath);
        presentFiles.add(partialPath);
        return "ok";
      });
      (sleep as jest.Mock).mockImplementation(async (ms: number) => {
        now += ms;
        if (ms === POLL_INTERVAL) {
          polls += 1;
          if (polls === 2) {
            presentFiles.delete(partialPath);
          }
        }
      });

      const service = new ScrapeService();
      await service.scrapeReport();

      expect(polls).toBe(2);
    });

    it("should throw when the download never arrives", async () => {
      mockExecuteScript.mockImplementation(async (script: string) =>
        script.includes("exportReport") ? "ok" : "ready"
      );

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        /report did not download to .*report\.pdf within 60000ms/
      );
    });

    it("should throw when the downloaded file is too small to be the report", async () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: 200 });

      const service = new ScrapeService();

      await expect(service.scrapeReport()).rejects.toThrow(
        "is only 200 bytes, expected at least 1024"
      );
    });

    it("should accept a file at the size floor", async () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });

      const service = new ScrapeService();

      await expect(service.scrapeReport()).resolves.toBe("mock-stream");
    });
  });

  describe("captureDiagnostics", () => {
    beforeEach(() => {
      presentFiles.add(CHROMEDRIVER_LOG);
    });

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
      presentFiles.delete(CHROMEDRIVER_LOG);
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
