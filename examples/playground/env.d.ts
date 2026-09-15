// Vite `?raw` imports resolve to the file text.
declare module '*?raw' {
  const text: string;
  export default text;
}

// `PRIMERS_API` from the dev server (vite.config.ts `define`); undefined in tests.
interface ImportMetaEnv {
  readonly PRIMERS_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
