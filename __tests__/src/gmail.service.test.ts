const mockSend = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    gmail: jest.fn(() => ({
      users: {
        messages: { send: mockSend },
      },
    })),
  },
}));

import { GmailService } from "../../src/gmail.service";
import { JWT } from "google-auth-library";

describe("GmailService", () => {
  let service: GmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GmailService({} as JWT);
  });

  describe("sendEmail", () => {
    it("should call gmail send with base64url-encoded message", async () => {
      mockSend.mockResolvedValue({ status: 200, data: { id: "msg-1" } });

      const response = await service.sendEmail({
        to: "user@example.com",
        subject: "Test Subject",
        body: "Test Body",
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0];
      expect(callArg.userId).toBe("me");
      expect(callArg.requestBody.raw).toBeDefined();

      // Decode and verify headers are present
      const decoded = Buffer.from(callArg.requestBody.raw, "base64url").toString();
      expect(decoded).toContain("To: user@example.com");
      expect(decoded).toContain("Subject: Test Subject");
      expect(decoded).toContain("Test Body");
      expect(response.status).toBe(200);
    });

    it("should include cc header when provided", async () => {
      mockSend.mockResolvedValue({ status: 200, data: {} });

      await service.sendEmail({
        to: "user@example.com",
        subject: "Test",
        body: "Body",
        cc: "cc@example.com",
      });

      const raw = mockSend.mock.calls[0][0].requestBody.raw;
      const decoded = Buffer.from(raw, "base64url").toString();
      expect(decoded).toContain("cc: cc@example.com");
    });

    it("should not include cc header when not provided", async () => {
      mockSend.mockResolvedValue({ status: 200, data: {} });

      await service.sendEmail({
        to: "user@example.com",
        subject: "Test",
        body: "Body",
      });

      const raw = mockSend.mock.calls[0][0].requestBody.raw;
      const decoded = Buffer.from(raw, "base64url").toString();
      expect(decoded).not.toContain("cc:");
    });

    it("should produce base64url encoding (no +, /, or trailing =)", async () => {
      mockSend.mockResolvedValue({ status: 200, data: {} });

      await service.sendEmail({
        to: "user@example.com",
        subject: "Special chars: +/=",
        body: "Content with various chars: àéîõü",
      });

      const raw: string = mockSend.mock.calls[0][0].requestBody.raw;
      expect(raw).not.toMatch(/[+/=]/);
    });
  });
});
