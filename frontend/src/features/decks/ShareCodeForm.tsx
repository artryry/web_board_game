import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";

import { normalizeShareCode } from "@/features/share/shareLink";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";

interface ShareCodeValues {
  code: string;
}

/**
 * Opens someone's share code on the import page. Case and spaces don't matter; the import page
 * asks the server whether the code exists.
 */
export function ShareCodeForm() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShareCodeValues>({ defaultValues: { code: "" } });

  const submit = handleSubmit(async ({ code }) => {
    await navigate(`/share/${normalizeShareCode(code)}`);
  });

  return (
    <section aria-labelledby="share-code-title" className="flex flex-col gap-3">
      <h2 id="share-code-title" className="text-lg font-semibold">
        Have a share code?
      </h2>
      <form noValidate onSubmit={(event) => void submit(event)} className="flex items-start gap-3">
        <TextField
          label="Share code"
          autoComplete="off"
          spellCheck={false}
          error={errors.code?.message}
          {...register("code", {
            validate: (value) => normalizeShareCode(value) !== "" || "Enter a share code.",
          })}
        />
        <Button type="submit" variant="secondary" className="mt-6">
          Open
        </Button>
      </form>
    </section>
  );
}
