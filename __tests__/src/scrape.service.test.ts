const mockGet = jest.fn();
const mockFindElement = jest.fn();
const mockWait = jest.fn();
const mockQuit = jest.fn();
const mockBuild = jest.fn();

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
      elementIsVisible: jest.fn(),
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
  createReadStream: jest.fn(() => "mock-stream"),
}));

import { ScrapeService } from "../../src/scrape.service";

describe("ScrapeService", () => {
  const originalEnv = process.env;

  const mockElement = {
    sendKeys: jest.fn(),
    click: jest.fn(),
    getAttribute: jest.fn(),
    findElements: jest.fn(),
    findElement: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
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
    });

    mockFindElement.mockResolvedValue(mockElement);
    mockWait.mockResolvedValue(undefined);
    mockGet.mockResolvedValue(undefined);
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
      const pdfLink = {
        click: jest.fn(),
      };
      mockElement.findElement.mockResolvedValue(pdfLink);

      const service = new ScrapeService();
      const result = await service.scrapeReport();

      expect(mockGet).toHaveBeenCalledWith("https://example.com/login");
      expect(result).toBe("mock-stream");
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
