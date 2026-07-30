/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_METERED_TURN_URL?: string;
  readonly VITE_METERED_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
