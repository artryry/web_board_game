interface ImportMetaEnv {
  /** Origin of the API. Empty or unset means the page's own origin (nginx in development). */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
