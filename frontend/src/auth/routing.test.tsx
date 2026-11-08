import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TEST_USER } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";

describe("route guards", () => {
  it("sends a logged-out user to /login and remembers the page", async () => {
    const view = renderApp("/");

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe("/login");
    expect(view.router.state.location.state).toEqual({ from: "/" });
  });

  it.each(["/login", "/register"])("sends a logged-in user from %s to /", async (path) => {
    saveSession();
    const view = renderApp(path);

    expect(
      await screen.findByRole("heading", { name: `Welcome, ${TEST_USER.username}` }),
    ).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe("/");
  });

  it("shows the 404 page inside the app shell", async () => {
    saveSession();
    renderApp("/no/such/page");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });
});
