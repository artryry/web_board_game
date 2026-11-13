import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useNavigate } from "react-router";

import { ApiError } from "@/api/errors";
import {
  rulesetQueryKey,
  useCreateRuleset,
  useRulesetValidation,
  useShowRefusedSave,
  useUpdateRuleset,
  type Ruleset,
} from "@/api/hooks/useRulesets";
import { showServerError } from "@/api/showServerError";
import { OutsideFieldErrors } from "@/catalog/outsideFieldErrors";
import type { Catalog } from "@/catalog/useCatalog";
import { ShareDialog } from "@/features/share/ShareDialog";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LeaveGuardDialog } from "@/ui/LeaveGuardDialog";
import { useLeaveGuard } from "@/ui/useLeaveGuard";

import { DeleteRulesetDialog } from "./DeleteRulesetDialog";
import { invalidRulesetErrors, NO_RULE_ERRORS, placeRuleErrors } from "./ruleErrors";
import { RuleErrorsContext } from "./ruleErrorsContext";
import { RulesHeader } from "./RulesHeader";
import { savedValues, toRulesetBody, type RulesFormValues } from "./rulesetValues";
import { RulesPhases } from "./RulesPhases";
import { RulesSettingsForm } from "./RulesSettingsForm";
import { useWatchedDefinition } from "./useWatchedDefinition";
import { ValidationStatus } from "./ValidationStatus";

interface RulesEditorProps {
  /** The saved rule set, or undefined for a new one (created on the first Save). */
  ruleset: Ruleset | undefined;
  initial: RulesFormValues;
  catalog: Catalog;
  /** The default rule set: shown, never changed. */
  readOnly: boolean;
}

const REFUSED_MESSAGE = "Couldn't save: fix the problems listed above.";

/**
 * The rules editor: settings, phases and Save. The server checks the rules as they change and
 * decides on Save; the client checks only the name and what `SchemaForm` takes from the catalog.
 */
export function RulesEditor({ ruleset, initial, catalog, readOnly }: RulesEditorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useCreateRuleset();
  const update = useUpdateRuleset();
  const showRefusedSave = useShowRefusedSave();
  const form = useForm<RulesFormValues>({ mode: "onTouched", defaultValues: initial });
  const { control, formState, handleSubmit, reset, setError } = form;
  const definition = useWatchedDefinition(control);
  const check = useRulesetValidation(definition, !readOnly);
  const placed = useMemo(
    () =>
      check.validation === undefined ? NO_RULE_ERRORS : placeRuleErrors(check.validation.errors),
    [check.validation],
  );
  const [dialog, setDialog] = useState<"share" | "delete" | null>(null);
  const dirty = formState.isDirty;
  const guard = useLeaveGuard(dirty);

  const submit = handleSubmit(async (values) => {
    const body = toRulesetBody(values);
    try {
      if (ruleset === undefined) {
        const created = await create.mutateAsync(body);
        guard.allowLeave();
        await navigate(`/rules/${created.id}`, { replace: true });
        return;
      }
      // The server's answer is the normalized definition, with every default filled in.
      reset(savedValues(await update.mutateAsync({ id: ruleset.id, body })));
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "ruleset_not_found" &&
        ruleset !== undefined
      ) {
        // Deleted elsewhere: the page reloads the rule set and shows that it's gone.
        guard.allowLeave();
        await queryClient.invalidateQueries({ queryKey: rulesetQueryKey(ruleset.id) });
        return;
      }
      const ruleErrors = invalidRulesetErrors(error);
      if (ruleErrors !== null) {
        showRefusedSave(body.definition, ruleErrors);
        setError("root.server", { message: REFUSED_MESSAGE });
        return;
      }
      showServerError(error, setError, ["name"]);
    }
  });

  const serverError = formState.errors.root?.server?.message;

  return (
    <div className="flex flex-col gap-6">
      <OutsideFieldErrors value={placed.fields}>
        <RuleErrorsContext value={placed}>
          <FormProvider {...form}>
            <form
              aria-label="Rule set"
              noValidate
              onSubmit={(event) => void submit(event)}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-3">
                <RulesHeader
                  savedId={readOnly ? undefined : ruleset?.id}
                  readOnly={readOnly}
                  saving={formState.isSubmitting}
                  onShare={() => {
                    setDialog("share");
                  }}
                  onDelete={() => {
                    setDialog("delete");
                  }}
                />
                {!readOnly && (
                  <ValidationStatus
                    validation={check.validation}
                    checking={check.checking}
                    error={check.error}
                    catalog={catalog}
                  />
                )}
                {serverError !== undefined && <ErrorAlert>{serverError}</ErrorAlert>}
              </div>
              <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <RulesSettingsForm readOnly={readOnly} />
                <RulesPhases catalog={catalog} readOnly={readOnly} />
              </div>
            </form>
          </FormProvider>
        </RuleErrorsContext>
      </OutsideFieldErrors>

      {ruleset !== undefined && !readOnly && (
        <>
          <ShareDialog
            target={
              dialog === "share"
                ? {
                    kind: "ruleset",
                    id: ruleset.id,
                    name: ruleset.name,
                    shareCode: ruleset.share_code,
                  }
                : null
            }
            unsavedNote={dirty}
            onClose={() => {
              setDialog(null);
            }}
          />
          <DeleteRulesetDialog
            ruleset={dialog === "delete" ? ruleset : null}
            onClose={() => {
              setDialog(null);
            }}
            onDeleted={() => {
              guard.allowLeave();
              void navigate("/rules");
            }}
          />
        </>
      )}
      <LeaveGuardDialog
        blocker={guard.blocker}
        message="Your changes to this rule set will be lost."
      />
    </div>
  );
}
