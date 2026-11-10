import { FormProvider, useForm } from "react-hook-form";

import { MAX_FIELD_EFFECTS, NAME_MAX_LENGTH } from "@/api/bounds";
import type { OriginBody } from "@/api/hooks/useOrigins";
import { showServerError } from "@/api/showServerError";
import { ModuleListField } from "@/catalog/ModuleListField";
import type { Catalog } from "@/catalog/useCatalog";
import { ArtUpload } from "@/features/cards/ArtUpload";
import { useArtField } from "@/features/cards/useArtField";
import { Button } from "@/ui/Button";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { TextField } from "@/ui/TextField";

import { toOriginBody, type OriginFormValues } from "./originValues";
import { OriginLookFields } from "./OriginLookFields";
import { OriginPreview } from "./OriginPreview";

interface OriginFormProps {
  catalog: Catalog;
  initial: OriginFormValues;
  /** The saved origin's background, shown until it is replaced or removed. */
  savedArt?: { key: string | null; url: string | null } | undefined;
  /** A system origin: everything shows, nothing can change. */
  readOnly?: boolean;
  submitLabel: string;
  onSubmit: (body: OriginBody) => Promise<unknown>;
  onCancel: () => void;
}

/** The origin editor's form and live preview, on its own page or in the card editor's modal. */
export function OriginForm({
  catalog,
  initial,
  savedArt,
  readOnly = false,
  submitLabel,
  onSubmit,
  onCancel,
}: OriginFormProps) {
  const form = useForm<OriginFormValues>({ mode: "onTouched", defaultValues: initial });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;
  const art = useArtField({
    form,
    name: "background_art_key",
    kind: "origin",
    saved: savedArt,
  });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(toOriginBody(values));
    } catch (error) {
      showServerError(error, setError, ["name", "background_art_key"], {
        invalid_art_key: "background_art_key",
      });
    }
  });

  return (
    <FormProvider {...form}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
          <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
            {errors.root?.server && <ErrorAlert>{errors.root.server.message}</ErrorAlert>}
            <TextField
              label="Name"
              autoComplete="off"
              error={errors.name?.message}
              {...register("name", {
                validate: (name) => name.trim() !== "" || "Give the origin a name.",
                maxLength: {
                  value: NAME_MAX_LENGTH,
                  message: `Use at most ${NAME_MAX_LENGTH} characters.`,
                },
              })}
            />
            <OriginLookFields catalog={catalog} />
            <ArtUpload
              label="Background image"
              art={art}
              frame="section"
              error={errors.background_art_key?.message}
            />
            <ModuleListField
              name="field_effects"
              label="Field effects"
              noun="field effect"
              modules={catalog.field_effects}
              max={MAX_FIELD_EFFECTS}
              readOnly={readOnly}
            />
          </fieldset>
          {!readOnly && (
            <div className="flex gap-3">
              <Button type="submit" busy={isSubmitting || art.uploading}>
                {art.uploading ? "Uploading art…" : submitLabel}
              </Button>
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          )}
        </form>
        <OriginPreview catalog={catalog} backgroundUrl={art.previewUrl} />
      </div>
    </FormProvider>
  );
}
