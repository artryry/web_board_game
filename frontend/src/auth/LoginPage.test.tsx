import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TEST_PASSWORD, TEST_USER } from "@/test/handlers";
import { renderApp } from "@/test/renderApp";

async function logIn(view: ReturnType<typeof renderApp>, password = TEST_PASSWORD) {
  await view.user.type(await screen.findByLabelText("Email"), TEST_USER.email);
  await view.user.type(screen.getByLabelText("Password"), password);
  await view.user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginPage", () => {
  it("goes back to the page the user came from", async () => {
    const view = renderApp("/decks?sort=name");
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();

    await logIn(view);

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe("/decks");
    expect(view.router.state.location.search).toBe("?sort=name");
  });

  it("opens the dashboard when there is no page to go back to", async () => {
    const view = renderApp("/login");

    await logIn(view);

    expect(
      await screen.findByRole("heading", { name: `Welcome, ${TEST_USER.username}` }),
    ).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe("/");
  });

  it("shows invalid_credentials as one message for the whole form", async () => {
    const view = renderApp("/login");

    await logIn(view, "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(view.router.state.location.pathname).toBe("/login");
  });

  it("checks the fields before sending anything", async () => {
    const view = renderApp("/login");

    await view.user.click(await screen.findByRole("button", { name: "Log in" }));

    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter your email.");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password.");
  });

  it("keeps the return page when switching to the register page", async () => {
    const view = renderApp("/decks");

    await view.user.click(await screen.findByRole("link", { name: "Create one" }));

    expect(view.router.state.location.pathname).toBe("/register");
    expect(view.router.state.location.state).toEqual({ from: "/decks" });
  });
});
