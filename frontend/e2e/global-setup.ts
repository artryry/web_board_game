import type { FullConfig } from "@playwright/test";

/** Fails early, with a clear message, when nginx or the API isn't running. */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost";
  const healthUrl = new URL("/api/health", baseURL);

  let response: Response;
  try {
    response = await fetch(healthUrl);
  } catch (error) {
    throw new Error(
      `Can't reach ${healthUrl.href}. Start the stack first: "docker compose up -d", then the API on port 8000.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(`${healthUrl.href} answered ${response.status}: ${await response.text()}`);
  }
}
