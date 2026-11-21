import { setupServer } from "msw/node";

import { contentHandlers } from "./contentHandlers";
import { handlers } from "./handlers";
import { roomHandlers } from "./roomHandlers";
import { roomSocketHandlers } from "./roomServer";

/**
 * The fake API and game socket for unit and component tests. Tests add or replace handlers with
 * `server.use`.
 */
export const server = setupServer(
  ...handlers,
  ...contentHandlers,
  ...roomHandlers,
  ...roomSocketHandlers,
);
