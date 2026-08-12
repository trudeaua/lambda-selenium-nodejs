import { JWT } from "google-auth-library";
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis/build/src/apis/gmail/v1";

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export class GmailService {
  private readonly mailService: gmail_v1.Resource$Users$Messages;

  /** Fixed so message encoding stays deterministic, nothing we attach can contain it */
  private static readonly BOUNDARY = "----=_ar_reports_scraper_boundary";

  /**
   * Service to handle notification-related actions like sending emails
   */
  public constructor(auth: JWT) {
    this.mailService = google.gmail({
      version: "v1",
      auth,
    }).users.messages;
  }

  private static encodeMessage(options: {
    to: string;
    from?: string;
    subject: string;
    body: string;
    cc?: string;
    attachments?: EmailAttachment[];
  }) {
    const { body, from, subject, to, cc, attachments } = options;
    const headers = [
      `To: ${to}`,
      ...(from ? [`From: ${from}`] : []),
      ...(cc ? [`cc: ${cc}`] : []),
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
    ];

    const message = attachments?.length
      ? GmailService.multipartMessage(headers, body, attachments)
      : [...headers, 'Content-Type: text/plain; charset="UTF-8"', "", body].join(
          "\r\n"
        );

    return Buffer.from(message).toString("base64url");
  }

  private static multipartMessage(
    headers: string[],
    body: string,
    attachments: EmailAttachment[]
  ) {
    const boundary = GmailService.BOUNDARY;
    return [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      body,
      ...attachments.flatMap((attachment) => [
        `--${boundary}`,
        `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        GmailService.wrapBase64(attachment.content.toString("base64")),
      ]),
      `--${boundary}--`,
    ].join("\r\n");
  }

  /** RFC 2045 caps encoded lines at 76 characters */
  private static wrapBase64(value: string) {
    return value.replace(/(.{76})/g, "$1\r\n");
  }

  /**
   * Send an email
   * @description Sends an email
   */
  public async sendEmail(options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    attachments?: EmailAttachment[];
  }) {
    const message = GmailService.encodeMessage(options);

    const response = await this.mailService.send({
      userId: "me",
      requestBody: {
        raw: message,
      },
    });

    return response;
  }
}
