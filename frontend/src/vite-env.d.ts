/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_APP_SUBTITLE: string;
  readonly VITE_APP_SIDEBAR_TITLE: string;
  readonly VITE_APP_LOGO_URL: string;
  readonly VITE_APP_THEME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
