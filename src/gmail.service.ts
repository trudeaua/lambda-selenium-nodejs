import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis/build/src/apis/gmail/v1";
export class GmailService {
  private readonly mailService: gmail_v1.Resource$Users$Messages;

  /**
   * Service to handle notification-related actions like sending emails
   */
  public constructor(client: OAuth2Client) {
    this.mailService = google.gmail({
      version: "v1",
      auth: client,
    }).users.messages;
  }

  private static encodeMessage(options: {
    to: string;
    from?: string;
    subject: string;
    body: string;
    cc?: string;
  }) {
    const { body, from, subject, to, cc } = options;
    const message = [
      "Content-Type: text/html; charset=rfc822\n",
      "MIME-Version: 1.0\n",
      "To: " + to,
      "\n",
      ...(from ? ["From: " + from, "\n"] : []),
      ...(cc ? ["cc: " + cc, "\n"] : []),
      "Subject: " + subject,
      "\n\n",
      body,
    ].join("");
    return Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
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
