import { useForm } from "react-hook-form";
import { Link, useLocation } from "react-router";

import { showServerError } from "@/api/showServerError";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";

import type { RegisterValues } from "./AuthContext";
import { AuthLayout } from "./AuthLayout";
import {
  EMAIL_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "./bounds";
import { keepFrom } from "./redirect";
import { useAuth } from "./useAuth";

// Server codes that belong to one input rather than to the whole form.
const FIELD_OF_CODE = { username_taken: "username", email_taken: "email" };

export function RegisterPage() {
  const { register: createAccount } = useAuth();
  const location = useLocation();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    mode: "onTouched",
    defaultValues: { username: "", email: "", password: "" },
  });

  // On success the user is logged in, and GuestRoute moves on to the dashboard.
  const onSubmit = handleSubmit(async (values) => {
    try {
      await createAccount(values);
    } catch (error) {
      showServerError(error, setError, ["username", "email", "password"], FIELD_OF_CODE);
    }
  });

  return (
    <AuthLayout
      title="Create an account"
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/login"
            state={keepFrom(location.state)}
            className="text-accent hover:underline"
          >
            Log in
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
          label="Username"
          autoComplete="username"
          error={errors.username?.message}
          {...register("username", {
            required: "Choose a username.",
            minLength: {
              value: USERNAME_MIN_LENGTH,
              message: `Use at least ${USERNAME_MIN_LENGTH} characters.`,
            },
            maxLength: {
              value: USERNAME_MAX_LENGTH,
              message: `Use at most ${USERNAME_MAX_LENGTH} characters.`,
            },
            pattern: {
              value: USERNAME_PATTERN,
              message: "Use only letters, digits and _.",
            },
          })}
        />
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
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password", {
            required: "Choose a password.",
            minLength: {
              value: PASSWORD_MIN_LENGTH,
              message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
            },
            maxLength: {
              value: PASSWORD_MAX_LENGTH,
              message: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
            },
          })}
        />
        <Button type="submit" busy={isSubmitting} className="mt-2">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
