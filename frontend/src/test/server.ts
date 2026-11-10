import { setupServer } from "msw/node";

import { contentHandlers } from "./contentHandlers";
import { handlers } from "./handlers";

/** The fake API for unit and component tests. Tests add or replace handlers with `server.use`. */
export const server = setupServer(...handlers, ...contentHandlers);
