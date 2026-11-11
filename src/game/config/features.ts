/**
 * Build-time feature flags.
 *
 * The admin campaign editor talks to the local Node server (`npm run dev`). It is never shipped
 * in the public static build (GitHub Pages): no admin button is shown and no `/api` request is
 * made unless the build runs in dev mode or explicitly sets `VITE_ENABLE_ADMIN=1`.
 */
export const ADMIN_ENABLED: boolean =
  import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_ADMIN === '1';
