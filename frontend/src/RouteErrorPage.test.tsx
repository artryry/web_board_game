import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";

import { onRouterError, rootErrorOptions } from "@/log/errorHandlers";
import { logged } from "@/test/logCapture";

import { RouteErrorPage } from "./RouteErrorPage";

function Broken(): never {
  throw new Error("render failed at secret line 42");
}

describe("RouteErrorPage", () => {
  it("replaces a page that throws, without the error's details, and the error is logged once", async () => {
    const router = createMemoryRouter([
      { path: "/", element: <Broken />, errorElement: <RouteErrorPage /> },
    ]);

    render(<RouterProvider router={router} onError={onRouterError} />, {
      onCaughtError: rootErrorOptions.onCaughtError,
    });

    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeVisible();
    expect(screen.queryByText(/secret line 42/)).not.toBeInTheDocument();
    const entries = logged("ui.render_error");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.error?.message).toBe("render failed at secret line 42");
  });
});
