import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError, errorMessage } from "@/api/errors";
import { handOffRoom, useCreateRoom } from "@/api/hooks/useRooms";
import { findDefaultRuleset, useRulesets, type Ruleset } from "@/api/hooks/useRulesets";
import { rulesetSummary } from "@/features/rules/rulesetValues";
import { Button } from "@/ui/Button";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LoadingState } from "@/ui/LoadingState";

import { ShowRules } from "./ShowRules";

/** `/rooms/new`: pick a rule set, create a room with it, and go to the room (UC3). */
export function CreateRoomPage() {
  const rulesets = useRulesets();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const create = useCreateRoom();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (rulesets.data === undefined) return <LoadingState error={rulesets.error} />;
  // The server lists the default first, then the user's own by name; the default starts picked.
  const chosen =
    rulesets.data.find((ruleset) => ruleset.id === chosenId) ??
    findDefaultRuleset(rulesets.data) ??
    rulesets.data[0];

  return (
    <section aria-labelledby="create-room-title" className="flex flex-col gap-6">
      <div>
        <h1 id="create-room-title" className="text-2xl font-semibold">
          Create a room
        </h1>
        <p className="mt-1 text-text-muted">
          Pick the rules for the game. Then share the room's code or link with a friend.
        </p>
      </div>
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen === undefined) return;
          create.mutate(chosen.id, {
            onSuccess: (room) => {
              handOffRoom(queryClient, room);
              // Back shouldn't land on a form that makes a second room.
              void navigate(`/room/${room.code}`, { replace: true });
            },
            onError: (error) => {
              if (error instanceof ApiError && error.code === "ruleset_not_found") {
                setChosenId(null);
                void queryClient.invalidateQueries({ queryKey: ["rulesets"] });
              }
            },
          });
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-lg font-semibold">Rule set</legend>
          {rulesets.data.map((ruleset) => (
            <RulesetOption
              key={ruleset.id}
              ruleset={ruleset}
              checked={ruleset.id === chosen?.id}
              onChoose={() => {
                setChosenId(ruleset.id);
                create.reset();
              }}
            />
          ))}
        </fieldset>
        {create.error !== null && <CreateError error={create.error} rulesetId={create.variables} />}
        <div>
          <Button type="submit" busy={create.isPending} disabled={chosen === undefined}>
            Create room
          </Button>
        </div>
      </form>
      {chosen !== undefined && <ShowRules key={chosen.id} definition={chosen.definition} />}
    </section>
  );
}

interface RulesetOptionProps {
  ruleset: Ruleset;
  checked: boolean;
  onChoose: () => void;
}

function RulesetOption({ ruleset, checked, onChoose }: RulesetOptionProps) {
  const summaryId = useId();
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-lg border bg-surface px-4 py-3 ${checked ? "border-accent" : "border-border"}`}
    >
      <label className="flex cursor-pointer items-center gap-3 font-medium">
        <input
          type="radio"
          name="ruleset"
          value={ruleset.id}
          checked={checked}
          aria-describedby={summaryId}
          onChange={onChoose}
          className="size-4 accent-accent"
        />
        {ruleset.name}
      </label>
      <p id={summaryId} className="pl-7 text-sm text-text-muted">
        {rulesetSummary(ruleset.definition)}
      </p>
    </div>
  );
}

function CreateError({ error, rulesetId }: { error: Error; rulesetId: string }) {
  if (error instanceof ApiError && error.code === "invalid_ruleset") {
    return (
      <ErrorAlert>
        This rule set has problems since a module changed. Open it in the rules editor to fix it.{" "}
        <Link to={`/rules/${rulesetId}`} className="underline">
          Open the rule set
        </Link>
      </ErrorAlert>
    );
  }
  if (error instanceof ApiError && error.code === "ruleset_not_found") {
    return <ErrorAlert>This rule set was deleted.</ErrorAlert>;
  }
  return <ErrorAlert>{errorMessage(error)}</ErrorAlert>;
}
