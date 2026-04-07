import fs from "fs";
import { JWT } from "google-auth-library";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis/build/src/apis/drive/v3";
import { formatDate } from "../utils/formatDate";

export class DriveService {
  private readonly drive: drive_v3.Resource$Files;
  private readonly DRIVE_FOLDER_ID: string;
  /**
   * Service to handle file-related actions such as upload
   */
  public constructor(auth: JWT) {
    this.drive = google.drive({ version: "v3", auth }).files;
    this.DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID ?? "";
  }

  private static getFileName() {
    const reportFileName = process.env.REPORT_FILENAME ?? "Report.pdf";
    const [basename, ext] = reportFileName.split(".");
    return `${basename}-${formatDate("YYYYMMDD")}.${ext}`;
  }

  /**
   * Upload an AR_AgingDetail report file
   * @param file File data
   * @returns `true` if the upload operation was successful, `false` otherwise
   */
  public async uploadFile(stream: fs.ReadStream) {
    const response = await this.drive.create({
      media: {
        body: stream,
        mimeType: "application/pdf",
      },
      requestBody: {
        parents: [this.DRIVE_FOLDER_ID],
        name: DriveService.getFileName(),
      },
    });
    return response.status.toString().startsWith("2");
  }
}
