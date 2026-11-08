import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TEST_USER } from "@/test/handlers";
import { renderApp } from "@/test/renderApp";

interface Account {
  username: string;
  email: string;
  password: string;
}

const NEW_ACCOUNT: Account = {
  username: "alice",
  email: "alice@example.com",
  password: "correct-horse",
};

async function fillIn(view: ReturnType<typeof renderApp>, account: Partial<Account>) {
  const fields = { username: "Username", email: "Email", password: "Password" } as const;
  for (const [key, label] of Object.entries(fields)) {
    const value = account[key as keyof Account];
    if (value !== undefined) await view.user.type(await screen.findByLabelText(label), value);
  }
}

async function submit(view: ReturnType<typeof renderApp>) {
  await view.user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("RegisterPage", () => {
  it("creates the account, logs in and opens the dashboard", async () => {
    const view = renderApp("/register");

    await fillIn(view, NEW_ACCOUNT);
    await submit(view);

    expect(
      await screen.findByRole("heading", { name: `Welcome, ${TEST_USER.username}` }),
    ).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe("/");
  });

  it.each([
    ["Username", "ab", "Use at least 3 characters."],
    ["Username", "a".repeat(33), "Use at most 32 characters."],
    ["Username", "bad name!", "Use only letters, digits and _."],
    ["Email", "not-an-email", "Enter a valid email address."],
    ["Password", "short", "Use at least 8 characters."],
  ])("checks the %s bounds as the user types (%s)", async (label, value, message) => {
    const view = renderApp("/register");

    await view.user.type(await screen.findByLabelText(label), value);
    await view.user.tab();

    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(message);
    expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
  });

  it("shows username_taken on the username field", async () => {
    const view = renderApp("/register");

    await fillIn(view, { ...NEW_ACCOUNT, username: "taken" });
    await submit(view);

    expect(await screen.findByLabelText("Username")).toHaveAccessibleDescription(
      "This username is already taken",
    );
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(view.router.state.location.pathname).toBe("/register");
  });

  it("shows email_taken on the email field", async () => {
    const view = renderApp("/register");

    await fillIn(view, { ...NEW_ACCOUNT, email: "taken@example.com" });
    await submit(view);

    expect(await screen.findByLabelText("Email")).toHaveAccessibleDescription(
      "An account with this email already exists",
    );
    expect(screen.getByLabelText("Username")).not.toHaveAttribute("aria-invalid");
  });
});
