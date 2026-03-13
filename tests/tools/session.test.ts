import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/db/store.js";
import { setMockScenarioHandler } from "../../src/tools/session.js";

beforeEach(() => store.reset());

describe("set_mock_scenario", () => {
  it("sets a valid scenario on the session", async () => {
    const result = await setMockScenarioHandler({ scenarioId: "payment_declined" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("payment_declined");
    expect(store.getSession()?.scenarioId).toBe("payment_declined");
  });

  it("clears the scenario when called without scenarioId", async () => {
    await setMockScenarioHandler({ scenarioId: "rate_limit_exceeded" });
    expect(store.getSession()?.scenarioId).toBe("rate_limit_exceeded");

    const result = await setMockScenarioHandler({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("happy path");
    // Confirm session still exists (startSession was called, not reset)
    expect(store.getSession()).not.toBeNull();
    expect(store.getSession()?.scenarioId).toBeUndefined();
  });

  it("returns isError for an unrecognised scenarioId", async () => {
    const result = await setMockScenarioHandler({ scenarioId: "does_not_exist" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("payment_declined");
    expect(result.content[0].text).toContain("rate_limit_exceeded");
  });

  it("preserves existing store data when scenario changes", async () => {
    store.stripe.customers.set("cus_test", {
      id: "cus_test",
      email: "a@b.com",
      name: "Test",
      created: 0,
      metadata: {},
    });
    await setMockScenarioHandler({ scenarioId: "payment_declined" });
    expect(store.stripe.customers.has("cus_test")).toBe(true);
  });
});
