import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useNavigate } from "react-router";

import { MANA_MAX, MANA_MIN, NAME_MAX_LENGTH } from "@/api/bounds";
import { useCreateCard, useUpdateCard, type Card } from "@/api/hooks/useCards";
import type { CardGroup } from "@/api/hooks/useCardGroups";
import type { Origin } from "@/api/hooks/useOrigins";
import { inUseItems } from "@/api/inUse";
import { showServerError } from "@/api/showServerError";
import type { Catalog } from "@/catalog/useCatalog";
import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { InUseList } from "@/ui/InUseList";
import { SelectField } from "@/ui/SelectField";
import { TextField } from "@/ui/TextField";

import { AbilitiesField } from "./AbilitiesField";
import { ArtUpload } from "./ArtUpload";
import { CardPreview } from "./CardPreview";
import { toCardBody, type CardFormValues } from "./cardValues";
import { CostSuggestion } from "./CostSuggestion";
import { DeleteCardDialog } from "./DeleteCardDialog";
import { KindField } from "./KindField";
import { NewOriginModal } from "./NewOriginModal";
import { OriginField } from "./OriginField";
import { StatFields } from "./StatFields";
import { useArtField } from "./useArtField";
import { wholeNumber } from "./wholeNumber";

interface CardFormProps {
  catalog: Catalog;
  origins: readonly Origin[];
  groups: readonly CardGroup[];
  initial: CardFormValues;
  /** The saved card; undefined for a new one. */
  card: Card | undefined;
  /** The library view to go back to after Save, Cancel or Delete. */
  backTo: string;
}

/**
 * The card editor. Save sends the whole form (the server re-checks the merged card anyway), and
 * is never blocked by the cost suggestion.
 */
export function CardForm({ catalog, origins, groups, initial, card, backTo }: CardFormProps) {
  const navigate = useNavigate();
  const form = useForm<CardFormValues>({ mode: "onTouched", defaultValues: initial });
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = form;
  const art = useArtField({
    form,
    name: "art_key",
    kind: "card",
    saved: card === undefined ? undefined : { key: card.art_key, url: card.art_url },
  });
  const create = useCreateCard();
  const update = useUpdateCard();
  const [saveError, setSaveError] = useState<unknown>(null);
  const [newOriginOpen, setNewOriginOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const submit = handleSubmit(async (values) => {
    setSaveError(null);
    const body = toCardBody(values, catalog);
    try {
      if (card === undefined) await create.mutateAsync(body);
      else await update.mutateAsync({ id: card.id, body });
      await navigate(backTo);
    } catch (error) {
      // Kept for a `card_in_use` answer, whose decks are listed under the message.
      setSaveError(error);
      showServerError(error, setError, ["name", "mana_cost", "hp", "dmg", "art_key"], {
        invalid_art_key: "art_key",
      });
    }
  });

  return (
    <FormProvider {...form}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex min-w-0 flex-col gap-6"
        >
          {errors.root?.server && (
            <ErrorAlert>
              <p>{errors.root.server.message}</p>
              <InUseList label="Decks" items={inUseItems(saveError, "decks")} />
            </ErrorAlert>
          )}
          <KindField />
          <TextField
            label="Name"
            autoComplete="off"
            error={errors.name?.message}
            {...register("name", {
              validate: (name) => name.trim() !== "" || "Give the card a name.",
              maxLength: {
                value: NAME_MAX_LENGTH,
                message: `Use at most ${NAME_MAX_LENGTH} characters.`,
              },
            })}
          />
          <OriginField
            origins={origins}
            onNewOrigin={() => {
              setNewOriginOpen(true);
            }}
          />
          <StatFields catalog={catalog} />
          <AbilitiesField catalog={catalog} />
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
            <TextField
              label="Mana cost"
              type="number"
              inputMode="numeric"
              min={MANA_MIN}
              max={MANA_MAX}
              error={errors.mana_cost?.message}
              {...register("mana_cost", wholeNumber("a mana cost", MANA_MIN, MANA_MAX))}
            />
            <CostSuggestion catalog={catalog} />
          </div>
          <SelectField label="Group" {...register("group_id")}>
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </SelectField>
          <ArtUpload label="Card art" art={art} frame="card" error={errors.art_key?.message} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" busy={isSubmitting || art.uploading}>
              {art.uploading ? "Uploading art…" : card === undefined ? "Create card" : "Save"}
            </Button>
            <ButtonLink variant="secondary" to={backTo}>
              Cancel
            </ButtonLink>
            {card !== undefined && (
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                Delete
              </Button>
            )}
          </div>
        </form>
        <aside>
          <CardPreview catalog={catalog} origins={origins} artUrl={art.previewUrl} />
        </aside>
      </div>

      {/* Outside the <form>: the origin modal holds a form of its own. */}
      <NewOriginModal
        open={newOriginOpen}
        catalog={catalog}
        onClose={() => {
          setNewOriginOpen(false);
        }}
        onCreated={(origin) => {
          setValue("origin_id", origin.id, { shouldDirty: true, shouldValidate: true });
          setNewOriginOpen(false);
        }}
      />
      {card !== undefined && (
        <DeleteCardDialog
          card={card}
          open={deleteOpen}
          onClose={() => {
            setDeleteOpen(false);
          }}
          onDeleted={() => void navigate(backTo)}
        />
      )}
    </FormProvider>
  );
}
