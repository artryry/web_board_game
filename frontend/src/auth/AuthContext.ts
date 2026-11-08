import { createContext } from "react";

import type { components } from "@/api/schema";

import type { SessionEndReason } from "./tokens";

export type User = components["schemas"]["UserOut"];
export type LoginValues = components["schemas"]["LoginRequest"];
export type RegisterValues = components["schemas"]["RegisterRequest"];

/** Why nobody is logged in. `none`: there was no saved session to restore. */
export type AnonymousReason = "none" | SessionEndReason;

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; reason: AnonymousReason }
  | { status: "authenticated"; user: User };

export interface AuthContextValue {
  state: AuthState;
  /** Throws an `ApiError` (for example `invalid_credentials`) for the form to show. */
  login: (values: LoginValues) => Promise<void>;
  /** Throws an `ApiError` (for example `username_taken`) for the form to show. */
  register: (values: RegisterValues) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
