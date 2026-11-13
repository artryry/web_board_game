import { screen, within } from "@testing-library/react";

import { contentStore } from "./contentStore";
import { renderApp, saveSession } from "./renderApp";

// Helpers for the rules editor's tests.

/** Opens a rules editor page and waits for its form. */
export async function openRulesEditor(path: string) {
  saveSession();
  const view = renderApp(path);
  await screen.findByRole("form", { name: "Rule set" });
  return view;
}

/** The phase rows of a pipeline ("Setup" or "Turn"), in order. */
export function phaseItems(pipeline: "Setup" | "Turn"): HTMLElement[] {
  const list = screen.getByRole("list", { name: pipeline });
  return [...list.children].filter((child) => child instanceof HTMLElement);
}

/** One phase row, by its position from 1. */
export function phaseItem(pipeline: "Setup" | "Turn", position: number): HTMLElement {
  const item = phaseItems(pipeline)[position - 1];
  if (item === undefined) throw new Error(`${pipeline} has no phase ${position}`);
  return item;
}

/** The names in the read-only "Turn order" strip. */
export function turnOrder(): string[] {
  const strip = screen.getByRole("list", { name: "Turn order" });
  return within(strip)
    .getAllByRole("listitem")
    .map((item) => item.textContent.replace("→", "").trim());
}

/** The definitions sent to `/validate`, oldest first. */
export function validatedDefinitions(): unknown[] {
  return contentStore.requests
    .filter((request) => request.method === "POST" && request.path === "/api/rulesets/validate")
    .map((request) => (request.body as { definition?: unknown }).definition);
}

/** The last body of `POST /api/rulesets` (exactly: `lastBody` would also match `/validate`). */
export function createBody(): unknown {
  return contentStore.requests.findLast(
    (request) => request.method === "POST" && request.path === "/api/rulesets",
  )?.body;
}
