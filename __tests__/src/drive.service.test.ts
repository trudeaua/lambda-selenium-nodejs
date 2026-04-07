const mockCreate = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    drive: jest.fn(() => ({
      files: { create: mockCreate },
    })),
  },
}));

jest.mock("../../utils/formatDate", () => ({
  formatDate: jest.fn(() => "20260407"),
}));

import { DriveService } from "../../src/drive.service";
import { JWT } from "google-auth-library";
import fs from "fs";

describe("DriveService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      DRIVE_FOLDER_ID: "folder-123",
      REPORT_FILENAME: "AR_AgingDetail.pdf",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("uploadFile", () => {
    it("should upload file with correct params and date-stamped name", async () => {
      mockCreate.mockResolvedValue({ status: 200 });

      const service = new DriveService({} as JWT);
      const stream = {} as fs.ReadStream;

      const result = await service.uploadFile(stream);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArg = mockCreate.mock.calls[0][0];
      expect(callArg.media.body).toBe(stream);
      expect(callArg.media.mimeType).toBe("application/pdf");
      expect(callArg.requestBody.parents).toEqual(["folder-123"]);
      expect(callArg.requestBody.name).toBe("AR_AgingDetail-20260407.pdf");
      expect(result).toBe(true);
    });

    it("should return false for non-2xx status", async () => {
      mockCreate.mockResolvedValue({ status: 403 });

      const service = new DriveService({} as JWT);
      const result = await service.uploadFile({} as fs.ReadStream);

      expect(result).toBe(false);
    });

    it("should use default filename when env var is not set", async () => {
      delete process.env.REPORT_FILENAME;
      mockCreate.mockResolvedValue({ status: 200 });

      const service = new DriveService({} as JWT);
      await service.uploadFile({} as fs.ReadStream);

      const name = mockCreate.mock.calls[0][0].requestBody.name;
      expect(name).toBe("Report-20260407.pdf");
    });
  });
});
