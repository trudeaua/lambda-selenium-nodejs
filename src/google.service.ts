import fs from "fs";
import { google } from "googleapis";
import { formatDate } from "utils/formatDate";
import { DriveService } from "./drive.service";
import { GmailService } from "./gmail.service";

export class GoogleService {
  private readonly driveService: DriveService;
  private readonly gmailService: GmailService;
  private readonly TO_EMAIL: string;
  private readonly SUCCESS_CC_EMAILS: string | undefined;
  private readonly FAIL_CC_EMAILS: string | undefined;
  private readonly reportFriendlyName: string;

  public constructor() {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    client.setCredentials({ refresh_token: refreshToken });
    this.driveService = new DriveService(client);
    this.gmailService = new GmailService(client);
    this.TO_EMAIL = process.env.TO_EMAIL ?? "";
    this.FAIL_CC_EMAILS = process.env.FAIL_CC_EMAILS;
    this.SUCCESS_CC_EMAILS = process.env.SUCCESS_CC_EMAILS;
    this.reportFriendlyName = process.env.REPORT_FRIENDLY_NAME ?? "Report";
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
   * Send a notification indicating that the report upload was successful
   */
  public async sendFailureNotification(error: Error) {
    await this.gmailService.sendEmail({
      to: this.TO_EMAIL,
      cc: this.FAIL_CC_EMAILS,
      subject: `Failed to get ${this.reportFriendlyName}`,
      body: `Failed to get ${this.reportFriendlyName}\nDiagnostics:${
        error.message
      }\n${error.stack ?? ""}`,
    });
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
