import { formatDate } from "../../utils/formatDate";

describe("formatDate", () => {
  it("should return a date string in the given format", () => {
    const result = formatDate("YYYY/MM/DD");
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it("should return a compact date string for YYYYMMDD format", () => {
    const result = formatDate("YYYYMMDD");
    expect(result).toMatch(/^\d{8}$/);
  });

  it("should return consistent results for the same format", () => {
    const a = formatDate("YYYY-MM-DD");
    const b = formatDate("YYYY-MM-DD");
    expect(a).toBe(b);
  });
});
