import { createMemoryRouter } from "react-router";
import { describe, expect, it, onTestFinished } from "vitest";

import { routes } from "@/routes";
import { logged } from "@/test/logCapture";

import { logPageViews } from "./pageViews";

describe("logPageViews", () => {
  it("logs the route pattern of the first page and of each navigation", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/cards/7f3c"] });
    onTestFinished(logPageViews(router));

    await router.navigate("/origins");
    await router.navigate("/");
    await router.navigate("/no/such/page");

    expect(logged("nav.page_viewed").map((entry) => entry.fields.route)).toEqual([
      "/cards/:id",
      "/origins",
      "/",
      "/*",
    ]);
    expect(logged("nav.page_viewed")[0]?.level).toBe("debug");
  });
});
