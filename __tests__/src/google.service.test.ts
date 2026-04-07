const mockSend = jest.fn();
const mockUploadFile = jest.fn();
const mockSendEmail = jest.fn();

jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
  GetSecretValueCommand: jest.fn((input: unknown) => input),
}));

jest.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: jest.fn(() => ({})),
    },
    gmail: jest.fn(() => ({ users: { messages: { send: jest.fn() } } })),
    drive: jest.fn(() => ({ files: { create: jest.fn() } })),
  },
}));

jest.mock("../../src/drive.service", () => ({
  DriveService: jest.fn(() => ({ uploadFile: mockUploadFile })),
}));

jest.mock("../../src/gmail.service", () => ({
  GmailService: jest.fn(() => ({ sendEmail: mockSendEmail })),
}));

jest.mock("utils/formatDate", () => ({
  formatDate: jest.fn(() => "2026/04/07"),
}));

import { GoogleService } from "../../src/google.service";
import fs from "fs";

describe("GoogleService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GOOGLE_IMPERSONATE_EMAIL: "user@domain.com",
      GOOGLE_SECRET_ID: "test-secret-id",
      AWS_REGION: "ca-central-1",
      TO_EMAIL: "to@example.com",
      SUCCESS_CC_EMAILS: "cc1@example.com",
      FAIL_CC_EMAILS: "cc2@example.com",
      REPORT_FRIENDLY_NAME: "AR Report",
    };
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        client_email: "sa@project.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
      }),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("create", () => {
    it("should fetch secret from Secrets Manager and return instance", async () => {
      const service = await GoogleService.create();
      expect(service).toBeInstanceOf(GoogleService);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ SecretId: "test-secret-id" })
      );
    });
  });

  describe("uploadReport", () => {
    it("should upload file and send success notification", async () => {
      mockUploadFile.mockResolvedValue(true);
      mockSendEmail.mockResolvedValue({});
      const service = await GoogleService.create();

      await service.uploadReport({} as fs.ReadStream);

      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "to@example.com",
          subject: "AR Report Available",
          cc: "cc1@example.com",
        })
      );
    });
  });

  describe("sendFailureNotification", () => {
    it("should send failure email with error details", async () => {
      mockSendEmail.mockResolvedValue({});
      const service = await GoogleService.create();
      const error = new Error("something broke");

      await service.sendFailureNotification(error);

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "to@example.com",
          cc: "cc2@example.com",
          subject: "Failed to get AR Report",
        })
      );
      const body = mockSendEmail.mock.calls[0][0].body;
      expect(body).toContain("something broke");
    });
  });
});
