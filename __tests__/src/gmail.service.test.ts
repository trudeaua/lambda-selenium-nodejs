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

    it("should encode attachments as multipart parts", async () => {
      mockSend.mockResolvedValue({ status: 200, data: {} });

      await service.sendEmail({
        to: "user@example.com",
        subject: "Failed",
        body: "Something broke",
        attachments: [
          {
            filename: "screenshot.png",
            mimeType: "image/png",
            content: Buffer.from("fake png bytes"),
          },
        ],
      });

      const raw = mockSend.mock.calls[0][0].requestBody.raw;
      const decoded = Buffer.from(raw, "base64url").toString();

      expect(decoded).toContain("Content-Type: multipart/mixed; boundary=");
      expect(decoded).toContain("Something broke");
      expect(decoded).toContain(
        'Content-Disposition: attachment; filename="screenshot.png"'
      );
      expect(decoded).toContain("Content-Type: image/png");
      expect(decoded).toContain(Buffer.from("fake png bytes").toString("base64"));
    });

    it("should not use multipart when there are no attachments", async () => {
      mockSend.mockResolvedValue({ status: 200, data: {} });

      await service.sendEmail({
        to: "user@example.com",
        subject: "Test",
        body: "Body",
        attachments: [],
      });

      const raw = mockSend.mock.calls[0][0].requestBody.raw;
      const decoded = Buffer.from(raw, "base64url").toString();
      expect(decoded).not.toContain("multipart/mixed");
    });

    it("should wrap attachment base64 at 76 characters", async () => {
      mockSend.mockResolvedValue({ status: 200, data: {} });

      await service.sendEmail({
        to: "user@example.com",
        subject: "Test",
        body: "Body",
        attachments: [
          {
            filename: "big.txt",
            mimeType: "text/plain",
            content: Buffer.from("a".repeat(1000)),
          },
        ],
      });

      const raw = mockSend.mock.calls[0][0].requestBody.raw;
      const decoded: string = Buffer.from(raw, "base64url").toString();
      const longLines = decoded
        .split("\r\n")
        .filter((line) => line.length > 76 && !line.startsWith("Content-"));
      expect(longLines).toEqual([]);
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
