import { useForm } from "react-hook-form";
import { Link, useLocation } from "react-router";

import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";

import type { LoginValues } from "./AuthContext";
import { AuthLayout } from "./AuthLayout";
import { EMAIL_PATTERN, PASSWORD_MAX_LENGTH } from "./bounds";
import { keepFrom } from "./redirect";
import { showServerError } from "./showServerError";
import { useAuth } from "./useAuth";

export function LoginPage() {
  const { login } = useAuth();
  const location = useLocation();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ mode: "onTouched", defaultValues: { email: "", password: "" } });

  // On success GuestRoute takes the user back to the page they came from.
  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
    } catch (error) {
      showServerError(error, setError, ["email", "password"]);
    }
  });

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          No account yet?{" "}
          <Link
            to="/register"
            state={keepFrom(location.state)}
            className="text-accent hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        {errors.root?.server && (
          <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
            {errors.root.server.message}
          </p>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email", {
            required: "Enter your email.",
            pattern: { value: EMAIL_PATTERN, message: "Enter a valid email address." },
          })}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password", {
            required: "Enter your password.",
            maxLength: {
              value: PASSWORD_MAX_LENGTH,
              message: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
            },
          })}
        />
        <Button type="submit" busy={isSubmitting} className="mt-2">
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
