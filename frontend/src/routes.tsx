import type { RouteObject } from "react-router";

import { AppShell } from "@/AppShell";
import { GuestRoute } from "@/auth/GuestRoute";
import { LoginPage } from "@/auth/LoginPage";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { RegisterPage } from "@/auth/RegisterPage";
import { CardEditorPage } from "@/features/cards/CardEditorPage";
import { CardLibraryPage } from "@/features/cards/CardLibraryPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DeckBuilderPage } from "@/features/decks/DeckBuilderPage";
import { DeckListPage } from "@/features/decks/DeckListPage";
import { OriginEditorPage } from "@/features/origins/OriginEditorPage";
import { OriginListPage } from "@/features/origins/OriginListPage";
import { ImportPage } from "@/features/share/ImportPage";
import { NotFoundPage } from "@/NotFoundPage";
import { RouteErrorPage } from "@/RouteErrorPage";

export const routes: RouteObject[] = [
  {
    element: <GuestRoute />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
  {
    // Every other page needs a login, the 404 page included.
    element: <ProtectedRoute />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            // A page that fails shows the error inside the shell, so the nav still works.
            errorElement: <RouteErrorPage />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "/origins", element: <OriginListPage /> },
              { path: "/origins/new", element: <OriginEditorPage /> },
              { path: "/origins/:id", element: <OriginEditorPage /> },
              { path: "/cards", element: <CardLibraryPage /> },
              { path: "/cards/new", element: <CardEditorPage /> },
              { path: "/cards/:id", element: <CardEditorPage /> },
              { path: "/decks", element: <DeckListPage /> },
              { path: "/decks/new", element: <DeckBuilderPage /> },
              { path: "/decks/:id", element: <DeckBuilderPage /> },
              { path: "/share/:code", element: <ImportPage /> },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
