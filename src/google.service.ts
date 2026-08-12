import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import fs from "fs";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { formatDate } from "../utils/formatDate";
import { DriveService } from "./drive.service";
import { GmailService, type EmailAttachment } from "./gmail.service";
import type { ScrapeDiagnostics } from "./scrape.service";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export class GoogleService {
  private readonly driveService: DriveService;
  private readonly gmailService: GmailService;
  private readonly TO_EMAIL: string;
  private readonly SUCCESS_CC_EMAILS: string | undefined;
  private readonly FAIL_CC_EMAILS: string | undefined;
  private readonly reportFriendlyName: string;

  private constructor(auth: JWT) {
    this.driveService = new DriveService(auth);
    this.gmailService = new GmailService(auth);
    this.TO_EMAIL = process.env.TO_EMAIL ?? "";
    this.FAIL_CC_EMAILS = process.env.FAIL_CC_EMAILS;
    this.SUCCESS_CC_EMAILS = process.env.SUCCESS_CC_EMAILS;
    this.reportFriendlyName = process.env.REPORT_FRIENDLY_NAME ?? "Report";
  }

  public static async create(): Promise<GoogleService> {
    const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION });
    const response = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: process.env.GOOGLE_SECRET_ID })
    );

    const secret: ServiceAccountKey = JSON.parse(response.SecretString!);
    const subject = process.env.GOOGLE_IMPERSONATE_EMAIL;

    const auth = new google.auth.JWT({
      email: secret.client_email,
      key: secret.private_key,
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      subject,
    });

    return new GoogleService(auth);
  }

  /**
   * Upload a report
   * @param file File to upload
   */
  public async uploadReport(stream: fs.ReadStream) {
    await this.driveService.uploadFile(stream);
    await this.sendSuccessNotification();
  }

  /**
   * Send a notification indicating that the report could not be fetched
   * @param error The error that ended the run
   * @param diagnostics Page state captured before the browser was torn down
   */
  public async sendFailureNotification(
    error: Error,
    diagnostics?: ScrapeDiagnostics
  ) {
    const bodyLines = [
      `Failed to get ${this.reportFriendlyName}`,
      "",
      `Diagnostics: ${error.message}`,
      "",
      error.stack ?? "",
    ];

    if (diagnostics?.currentUrl) {
      bodyLines.push("", `URL at failure: ${diagnostics.currentUrl}`);
    }
    if (diagnostics?.captureErrors?.length) {
      bodyLines.push(
        "",
        `Could not capture: ${diagnostics.captureErrors.join("; ")}`
      );
    }

    await this.gmailService.sendEmail({
      to: this.TO_EMAIL,
      cc: this.FAIL_CC_EMAILS,
      subject: `Failed to get ${this.reportFriendlyName}`,
      body: bodyLines.join("\n"),
      attachments: GoogleService.diagnosticAttachments(diagnostics),
    });
  }

  /**
   * Turn captured page state into email attachments
   */
  private static diagnosticAttachments(diagnostics?: ScrapeDiagnostics) {
    const attachments: EmailAttachment[] = [];
    if (!diagnostics) {
      return attachments;
    }

    if (diagnostics.screenshotBase64) {
      attachments.push({
        filename: "screenshot.png",
        mimeType: "image/png",
        content: Buffer.from(diagnostics.screenshotBase64, "base64"),
      });
    }
    if (diagnostics.pageSource) {
      attachments.push({
        filename: "page-source.html",
        mimeType: "text/html",
        content: Buffer.from(diagnostics.pageSource, "utf8"),
      });
    }
    if (diagnostics.chromedriverLog) {
      attachments.push({
        filename: "chromedriver.log",
        mimeType: "text/plain",
        content: Buffer.from(diagnostics.chromedriverLog, "utf8"),
      });
    }

    return attachments;
  }

  /**
   * Send a notification indicating that the report upload was successful
   */
  private async sendSuccessNotification() {
    await this.gmailService.sendEmail({
      to: this.TO_EMAIL,
      subject: `${this.reportFriendlyName} Available`,
      body: `${this.reportFriendlyName} Available for ${formatDate(
        "YYYY/MM/DD"
      )}`,
      cc: this.SUCCESS_CC_EMAILS,
    });
  }
}
