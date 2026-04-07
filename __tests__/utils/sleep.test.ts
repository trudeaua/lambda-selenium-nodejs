import { sleep } from "../../utils/sleep";

describe("sleep", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should resolve after the specified time", async () => {
    const promise = sleep(1000);

    jest.advanceTimersByTime(1000);

    await expect(promise).resolves.toBeUndefined();
  });

  it("should not resolve before the specified time", async () => {
    let resolved = false;
    sleep(1000).then(() => {
      resolved = true;
    });

    jest.advanceTimersByTime(500);
    await Promise.resolve(); // flush microtasks

    expect(resolved).toBe(false);
  });
});
