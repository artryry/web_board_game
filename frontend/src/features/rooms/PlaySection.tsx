import { useState } from "react";

import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";

import { BackToRoom } from "./BackToRoom";
import { JoinByCodeDialog } from "./JoinByCodeDialog";

/** The dashboard's way into a game: create a room, join one by code, or go back to the last one. */
export function PlaySection() {
  const [joining, setJoining] = useState(false);

  return (
    <section
      aria-labelledby="play-title"
      className="mt-6 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="play-title" className="text-lg font-semibold">
        Play
      </h2>
      <div className="flex flex-wrap gap-3">
        <ButtonLink to="/rooms/new">Create room</ButtonLink>
        <Button
          variant="secondary"
          onClick={() => {
            setJoining(true);
          }}
        >
          Join by code
        </Button>
        <BackToRoom />
      </div>
      <JoinByCodeDialog
        open={joining}
        onClose={() => {
          setJoining(false);
        }}
      />
    </section>
  );
}
