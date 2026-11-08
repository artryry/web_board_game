import type { RouteObject } from "react-router";

import { AppShell } from "@/AppShell";
import { GuestRoute } from "@/auth/GuestRoute";
import { LoginPage } from "@/auth/LoginPage";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { RegisterPage } from "@/auth/RegisterPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { NotFoundPage } from "@/NotFoundPage";

export const routes: RouteObject[] = [
  {
    element: <GuestRoute />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
  {
    // Every other page needs a login, the 404 page included.
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
