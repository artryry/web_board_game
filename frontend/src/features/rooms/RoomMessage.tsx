import type { ReactNode } from "react";

import { ButtonLink } from "@/ui/ButtonLink";

interface RoomMessageProps {
  /** Why the room can't be shown. */
  children: ReactNode;
  /** A way to fix it, next to Back to the dashboard. */
  action?: ReactNode;
}

/** What the room page says in place of the room: it's gone, full, or open somewhere else. */
export function RoomMessage({ children, action }: RoomMessageProps) {
  return (
    <section
      aria-labelledby="room-message"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center"
    >
      <p id="room-message" className="text-lg">
        {children}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {action}
        <ButtonLink to="/" variant={action === undefined ? "primary" : "secondary"}>
          Back to the dashboard
        </ButtonLink>
      </div>
    </section>
  );
}
