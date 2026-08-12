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

  try {
    const googleService = await GoogleService.create();

    try {
      const report = await scrapeService.scrapeReport();
      if (!report) {
        return;
      }
      await googleService.uploadReport(report);
      return { statusCode: 200 };
    } catch (e) {
      if (!(e instanceof Error)) {
        console.error("run failed with a non-Error value", e);
        return;
      }
      // Capture the page before the finally block tears the browser down
      const diagnostics = await scrapeService.captureDiagnostics();
      await googleService.sendFailureNotification(e, diagnostics);
    }
  } finally {
    try {
      await scrapeService.destroy();
    } catch (e) {
      console.error("failed to quit the webdriver", e);
    }
  }
};
