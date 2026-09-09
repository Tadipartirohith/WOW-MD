/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_BACKEND_URL: string;
  // Public base URL of the SPA, used to build shareable links (e.g. an event
  // invitation) that open on other devices. Falls back to window.location.origin.
  readonly VITE_APP_BASE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
