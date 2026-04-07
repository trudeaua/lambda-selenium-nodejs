import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import fs from "fs";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { formatDate } from "../utils/formatDate";
import { DriveService } from "./drive.service";
import { GmailService } from "./gmail.service";

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
