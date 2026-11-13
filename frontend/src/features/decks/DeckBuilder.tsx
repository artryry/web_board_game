import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";

import { ApiError } from "@/api/errors";
import type { Card } from "@/api/hooks/useCards";
import { deckQueryKey, useCreateDeck, useUpdateDeck, type Deck } from "@/api/hooks/useDecks";
import type { Origin } from "@/api/hooks/useOrigins";
import type { Ruleset } from "@/api/hooks/useRulesets";
import { inUseItems } from "@/api/inUse";
import { showServerError } from "@/api/showServerError";
import type { Catalog } from "@/catalog/useCatalog";
import { ShareDialog } from "@/features/share/ShareDialog";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { InUseList } from "@/ui/InUseList";
import { LeaveGuardDialog } from "@/ui/LeaveGuardDialog";
import { useLeaveGuard } from "@/ui/useLeaveGuard";

import { DeckDnd } from "./DeckDnd";
import {
  addCopy,
  cardsOutsideOrigin,
  keepOrigin,
  removeCopy,
  sameCards,
  toDeckCards,
  type DeckEntry,
} from "./deckEntries";
import { DeckHeader, type DeckHeaderValues } from "./DeckHeader";
import { DeckLibraryPanel } from "./DeckLibraryPanel";
import { DeckPanel } from "./DeckPanel";
import { DeckValidityPanel } from "./DeckValidityPanel";
import { DeleteDeckDialog } from "./DeleteDeckDialog";
import { ManaCurveChart } from "./ManaCurveChart";
import { OriginChangeDialog } from "./OriginChangeDialog";
import { useLibraryCards } from "./useLibraryCards";

interface DeckBuilderProps {
  /** The saved deck, or undefined for a new one (created on the first Save). */
  deck: Deck | undefined;
  catalog: Catalog;
  origins: readonly Origin[];
  /** Undefined when they didn't load: only the validity panel needs them. */
  rulesets: readonly Ruleset[] | undefined;
  neutralId: string;
}

const CARD_GONE_MESSAGE =
  "A card in this deck no longer exists. Reload the page to see the deck as it is now.";

/** The deck builder: the library, the deck, and Save. Nothing reaches the server until Save. */
export function DeckBuilder({ deck, catalog, origins, rulesets, neutralId }: DeckBuilderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useCreateDeck();
  const update = useUpdateDeck();
  const form = useForm<DeckHeaderValues>({
    mode: "onTouched",
    defaultValues: { name: deck?.name ?? "", origin_id: deck?.origin_id ?? "" },
  });
  const { control, formState, handleSubmit, reset, setError, setValue } = form;
  const originId = useWatch({ control, name: "origin_id" });
  const [entries, setEntries] = useState<readonly DeckEntry[]>(deck?.cards ?? []);
  const [savedEntries, setSavedEntries] = useState<readonly DeckEntry[]>(deck?.cards ?? []);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [pendingOrigin, setPendingOrigin] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"share" | "delete" | null>(null);
  const library = useLibraryCards(originId, neutralId);
  const dirty = formState.isDirty || !sameCards(entries, savedEntries);
  const guard = useLeaveGuard(dirty);

  function add(card: Card) {
    setEntries((current) => addCopy(current, card));
  }

  function applyOrigin(next: string) {
    setValue("origin_id", next, { shouldDirty: true, shouldValidate: true });
    setEntries((current) => keepOrigin(current, next, neutralId));
  }

  function changeOrigin(next: string) {
    if (cardsOutsideOrigin(entries, next, neutralId).length > 0) setPendingOrigin(next);
    else applyOrigin(next);
  }

  const submit = handleSubmit(async (values) => {
    setSaveError(null);
    // Always the whole list, with the origin: the server rejects an origin change while cards of
    // the old origin remain.
    const body = {
      name: values.name.trim(),
      origin_id: values.origin_id,
      cards: toDeckCards(entries),
    };
    try {
      if (deck === undefined) {
        const created = await create.mutateAsync(body);
        guard.allowLeave();
        await navigate(`/decks/${created.id}`, { replace: true });
        return;
      }
      const saved = await update.mutateAsync({ id: deck.id, body });
      reset({ name: saved.name, origin_id: saved.origin_id });
      setEntries(saved.cards);
      setSavedEntries(saved.cards);
    } catch (error) {
      if (error instanceof ApiError && error.code === "deck_not_found" && deck !== undefined) {
        // Deleted elsewhere: the page reloads the deck and shows that it's gone.
        guard.allowLeave();
        await queryClient.invalidateQueries({ queryKey: deckQueryKey(deck.id) });
        return;
      }
      setSaveError(error);
      if (error instanceof ApiError && error.code === "invalid_deck_cards") {
        setError("root.server", { message: CARD_GONE_MESSAGE });
        return;
      }
      showServerError(error, setError, ["name", "origin_id"], { invalid_origin: "origin_id" });
    }
  });

  const pendingName = origins.find((origin) => origin.id === pendingOrigin)?.name ?? null;
  const serverError = formState.errors.root?.server?.message;

  return (
    <div className="flex flex-col gap-6">
      <FormProvider {...form}>
        <form aria-label="Deck" noValidate onSubmit={(event) => void submit(event)}>
          <DeckHeader
            origins={origins}
            saved={deck !== undefined}
            saving={formState.isSubmitting}
            onOriginChange={changeOrigin}
            onShare={() => {
              setDialog("share");
            }}
            onDelete={() => {
              setDialog("delete");
            }}
          />
        </form>
      </FormProvider>
      {serverError !== undefined && (
        <ErrorAlert>
          <p>{serverError}</p>
          <InUseList label="Cards" items={inUseItems(saveError, "cards")} />
        </ErrorAlert>
      )}

      <DeckDnd cards={library.cards} origins={origins} catalog={catalog} onDropOnDeck={add}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <DeckLibraryPanel
            originId={originId}
            cards={library.cards}
            error={library.error}
            entries={entries}
            origins={origins}
            catalog={catalog}
            onAdd={add}
          />
          <div className="flex flex-col gap-6">
            <DeckPanel
              entries={entries}
              origins={origins}
              onAdd={add}
              onRemove={(card) => {
                setEntries((current) => removeCopy(current, card.id));
              }}
            />
            <ManaCurveChart entries={entries} />
            <DeckValidityPanel
              entries={entries}
              rulesets={rulesets}
              originId={originId}
              neutralId={neutralId}
            />
          </div>
        </div>
      </DeckDnd>

      <OriginChangeDialog
        originName={pendingName}
        dropped={
          pendingOrigin === null ? [] : cardsOutsideOrigin(entries, pendingOrigin, neutralId)
        }
        onConfirm={() => {
          if (pendingOrigin !== null) applyOrigin(pendingOrigin);
          setPendingOrigin(null);
        }}
        onClose={() => {
          setPendingOrigin(null);
        }}
      />
      {deck !== undefined && (
        <>
          <ShareDialog
            target={
              dialog === "share"
                ? { kind: "deck", id: deck.id, name: deck.name, shareCode: deck.share_code }
                : null
            }
            unsavedNote={dirty}
            onClose={() => {
              setDialog(null);
            }}
          />
          <DeleteDeckDialog
            deck={dialog === "delete" ? deck : null}
            onClose={() => {
              setDialog(null);
            }}
            onDeleted={() => {
              guard.allowLeave();
              void navigate("/decks");
            }}
          />
        </>
      )}
      <LeaveGuardDialog blocker={guard.blocker} message="Your changes to this deck will be lost." />
    </div>
  );
}
