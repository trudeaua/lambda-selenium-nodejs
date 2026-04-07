const mockScrapeReport = jest.fn();
const mockDestroy = jest.fn();
const mockUploadReport = jest.fn();
const mockSendFailureNotification = jest.fn();
const mockCreate = jest.fn();

jest.mock("dotenv", () => ({ config: jest.fn() }));

jest.mock("../src/scrape.service", () => ({
  ScrapeService: jest.fn(() => ({
    scrapeReport: mockScrapeReport,
    destroy: mockDestroy,
  })),
}));

jest.mock("../src/google.service", () => ({
  GoogleService: {
    create: mockCreate,
  },
}));

import { handler } from "../index";

describe("handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      uploadReport: mockUploadReport,
      sendFailureNotification: mockSendFailureNotification,
    });
  });

  it("should scrape, destroy driver, upload report, and return 200", async () => {
    const mockStream = {};
    mockScrapeReport.mockResolvedValue(mockStream);
    mockUploadReport.mockResolvedValue(undefined);

    const result = await handler(undefined, undefined);

    expect(mockScrapeReport).toHaveBeenCalledTimes(1);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(mockUploadReport).toHaveBeenCalledWith(mockStream);
    expect(result).toEqual({ statusCode: 200 });
  });

  it("should return early if scrapeReport returns null", async () => {
    mockScrapeReport.mockResolvedValue(null);

    const result = await handler(undefined, undefined);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(mockUploadReport).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("should send failure notification on error", async () => {
    const error = new Error("scrape failed");
    mockScrapeReport.mockRejectedValue(error);
    mockSendFailureNotification.mockResolvedValue(undefined);

    await handler(undefined, undefined);

    expect(mockSendFailureNotification).toHaveBeenCalledWith(error);
  });

  it("should not send failure notification for non-Error throws", async () => {
    mockScrapeReport.mockRejectedValue("string error");

    await handler(undefined, undefined);

    expect(mockSendFailureNotification).not.toHaveBeenCalled();
  });
});
