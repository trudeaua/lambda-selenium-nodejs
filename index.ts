import { APIGatewayEvent, Context } from "aws-lambda";
import dotenv from "dotenv";
import { GoogleService } from "./src/google.service";
import { ScrapeService } from "./src/scrape.service";

dotenv.config();

export const handler = async (
  _event: APIGatewayEvent | undefined,
  _context: Context | undefined
) => {
  const scrapeService = new ScrapeService();
  const googleService = new GoogleService();

  try {
    const report = await scrapeService.scrapeReport();
    await scrapeService.destroy();
    if (!report) {
      return;
    }
    await googleService.uploadReport(report);
    return { statusCode: 200 };
  } catch (e) {
    if (e instanceof Error) {
      await googleService.sendFailureNotification(e);
    }
  }
};
