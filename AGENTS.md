# Working plan maintenance

## Reusable UI components

Always put reusable website components in the root `utils/` folder, grouped by feature when useful (for example `utils/auth`, `utils/landing`, `utils/Canyon404.tsx`). Route files import these components and remain thin. Reuse existing components before creating alternatives. This applies to all future pages, themes, animations and error screens.

Read `plan.md` before continuing project work. Update its two sections after each completed work batch with verified results and remaining tasks. Hosting stays paused throughout every phase; hosting setup and deployment happen only after all website phases are complete and the website works end to end. Do not treat an intermediate phase as deployment authorization.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
