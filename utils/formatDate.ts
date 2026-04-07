import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);
const TZ = process.env.TZ ?? "America/New_York";
dayjs.tz.setDefault(TZ);

export function formatDate(format: string) {
  return dayjs().tz(TZ).format(format);
}
