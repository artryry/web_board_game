import type { RouteObject } from "react-router";

import { AppShell } from "@/AppShell";
import { GuestRoute } from "@/auth/GuestRoute";
import { LoginPage } from "@/auth/LoginPage";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { RegisterPage } from "@/auth/RegisterPage";
import { CardEditorPage } from "@/features/cards/CardEditorPage";
import { CardLibraryPage } from "@/features/cards/CardLibraryPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { OriginEditorPage } from "@/features/origins/OriginEditorPage";
import { OriginListPage } from "@/features/origins/OriginListPage";
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
          { path: "/origins", element: <OriginListPage /> },
          { path: "/origins/new", element: <OriginEditorPage /> },
          { path: "/origins/:id", element: <OriginEditorPage /> },
          { path: "/cards", element: <CardLibraryPage /> },
          { path: "/cards/new", element: <CardEditorPage /> },
          { path: "/cards/:id", element: <CardEditorPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
