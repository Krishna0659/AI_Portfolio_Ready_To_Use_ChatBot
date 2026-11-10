---
name: PortfolioAI
description: A compact evidence-review workspace on a framed white sheet.
colors:
  ground: "#edf1f2"
  surface: "#fff"
  text: "#202629"
  muted: "#60696e"
  border: "#e4e8e9"
  accent: "#1b6c80"
  active: "#e0e6e8"
  negative: "#a12532"
  action: "#222b2e"
  dark-ground: "#16191b"
  dark-surface: "#202426"
  dark-text: "#edf0f1"
  dark-muted: "#b5bec2"
  dark-border: "#363d40"
  dark-accent: "#80c4d5"
  dark-active: "#333b3e"
  dark-control: "#667277"
  dark-well: "#292f32"
  dark-selected: "#2b4148"
  dark-negative: "#ffb2bc"
  dark-action-hover: "#c5d8dd"
  dark-selection: "#3b6874"
typography:
  headline:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "12px"
  metric:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "28px"
    fontWeight: 500
rounded:
  badge: "4px"
  control: "6px"
  panel: "12px"
  sheet: "16px"
spacing:
  compact: "8px"
  control: "12px"
  inset: "16px"
  panel: "20px"
  grid: "24px"
  page: "30px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px"
  nav-active:
    backgroundColor: "{colors.active}"
    textColor: "{colors.text}"
    padding: "10px 12px"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  badge:
    backgroundColor: "#edf0f1"
    textColor: "#4e595f"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  source-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    padding: "15px 20px"
---

# Design System: PortfolioAI

## Overview

**Creative North Star: "The Framed Sheet"**

PortfolioAI places a dense, practical workspace inside a pale blue-gray frame. A flat white working sheet, compact navigation, restrained typography and divided source rows keep evidence and editing actions easy to inspect. The outlined P mark is the only brand illustration.

This document records the implemented system in `app/style.css` and `app/workspace.tsx`, checked against the screenshots in `docs/screenshots`. The user requested the denser dashboard composition. The name above describes the implemented direction; no image comp was approved, and the complete Impeccable visual selection process was not performed. It is not a claim of user approval of every visual choice.

**Key Characteristics:**
- Pale frame around a white working sheet.
- Compact IBM Plex Sans typography and tabular metrics.
- Flat bordered panels and full-width source rows.
- Sparse teal focus, selection and brand accents.
- Explicit evidence, draft, approval and delivery states.

## Colors

The palette is cool and low-chroma, with charcoal actions and teal functional emphasis.

### Primary
- **Evidence Teal** (`accent`): outlined brand mark, keyboard focus, selected import-tab underline, checkbox accents and unsaved-change indicator.
- **Action Charcoal** (`action`): primary actions such as adding sources, saving drafts and approving versions.

### Neutral
- **Pale Frame** (`ground`): page ground and sidebar surround.
- **Working White** (`surface`): main sheet, panels and controls.
- **Reading Charcoal** (`text`): headings, control labels and source names.
- **Slate Gray** (`muted`): supporting copy, timestamps and metadata.
- **Quiet Divider** (`border`): sheet outline, panel outlines and row separation.
- **Navigation Gray** (`active`): persistent active navigation background.

Error text uses `negative`; failed badges add a pale rose ground. Successful imports use a pale green badge and dark green text, always with a written status. Selected evidence uses a pale blue wash with an inset boundary.

**The State Has Words Rule.** Color supports a written state; it never replaces the status label.

## Typography

**Display and Body Font:** IBM Plex Sans, served locally, with sans-serif fallback. There is no separate display family. Evidence text also uses the body family, preserving readable paragraphs instead of a code-block appearance; version hashes retain native monospace.

The hierarchy is intentionally compact. Page headings use the `headline` role; panel titles use `title`. Profile-summary headings are medium weight (23px, line-height 1.3). The sign-in heading is larger (32px). Paragraphs use the `body` role, while metadata commonly uses `label`; badges use small medium-weight text (11px). Metrics use tabular numerals. Page introduction copy is limited to 75 characters of measure.

On mobile, page headings reduce to 22px, supporting introduction text to 13px and metrics to 26px. This is a working interface, with no oversized display headline inside the dashboard.

## Layout

The desktop shell uses a fixed sidebar (214px) and flexible content column. The working sheet has an outer inset (8px), a compact top bar (52px) and page padding from the `page` spacing token. The overview has four horizontally divided metrics and a two-column panel grid (1.3fr / 1fr, 24px gap). Source inspection pairs a source list with evidence; review pairs a flexible editor with a sticky approval column (300px).

At 1100px and below, the sidebar narrows to 172px, page padding becomes 24px, sources stack and version actions move beneath their metadata. At 760px and below, navigation becomes a horizontally scrollable row, the sidebar account details disappear, and the sheet sits beneath it. The overview, review and settings grids become single-column; metrics use two columns. Page padding becomes 22px vertically and 16px horizontally. Approval stops sticking. Import actions become full width. Sign-out remains available in Settings.

Keep dense content legible through aligned labels, consistent row divisions and restrained panel padding. Evidence wraps long text and scrolls within a maximum height of 460px. Source names wrap long strings instead of forcing horizontal overflow.

## Elevation & Depth

The interface has no ambient drop shadows. Depth comes from the pale frame, white sheet, thin outlines and quiet tinted editing areas. The selected source uses an inset one-pixel outline (`inset 0 0 0 1px #9ab7c0`), which communicates selection rather than elevation. Keyboard focus uses a teal outline (2px with 3px offset).

**The Flat Workspace Rule.** Use borders and surface tone to separate workspace regions; keep the default sheet and panels free of drop shadows.

## Shapes

Controls use the `control` radius, panels the `panel` radius and the main desktop sheet the `sheet` radius. The mobile sheet adopts the panel radius. Status badges are gently squared using the `badge` radius, not pills. Source rows have square corners inside a rounded, clipped list panel. Icons use thin outlined geometry; status dots are small circles (6px).

## Components

### Buttons
Compact, clear actions. Primary buttons are charcoal with white type and darken toward a lighter charcoal on hover (`#344348`). Secondary buttons are white with a gray outline and a pale hover fill (`#f0f4f5`). Both use medium weight, the control radius and minimum height of 36px. Mobile increases regular controls to at least 44px; compact fact-removal controls retain their existing smaller rule. Disabled controls use half opacity and a non-interactive cursor. Focus uses the shared visible outline. No animated transitions are currently defined.

### Inputs / Fields
White, gray-outlined controls with the control radius and 10px internal padding. Labels sit above their controls with a 7px gap. Placeholders are muted. Textareas use comfortable line-height (1.6) and resize vertically. Native checkboxes use the teal accent. Errors are surfaced in an alert message; there is no implemented per-field validation color system.

### Navigation
Desktop navigation uses full-width, left-aligned buttons with outlined icons and quiet count metadata. The active item has a persistent gray fill. On mobile the text labels remain while icons disappear, and the row can scroll. Source-type tabs use a teal underline to distinguish the selected type.

### Chips
Read-only rectangular status badges show import or profile state. Neutral badges use gray, successful imports green and failed imports rose. Keep their visible state words; badges do not behave like filter buttons.

### Cards / Containers
White panels use a thin quiet border, the panel radius and clipped contents. Header padding is 18px vertically and 20px horizontally; footers use a top divider and compact metadata. Mobile headers reduce to 16px padding. Editing identity fields and evidence text use a lightly tinted inset surface.

### Source Rows and Evidence
Each full-width source button presents a wrapping name and kind on the left, and a status badge on the right. Rows are at least 72px high. The selected row retains a blue-gray wash and inset boundary with an `aria-pressed` state. Selecting a row reveals captured evidence and its timestamp; adding it to the draft remains an explicit action. The evidence block uses body typography, generous line-height (1.7) and internal scrolling.

### Approval and Messages
The approval panel stays alongside the desktop editor and presents revision metadata, explicit review acknowledgments and a full-width primary action. On small screens it follows the editor. Informational messages use a pale teal surface; failures use a pale red surface and alert semantics. Written notices distinguish saving, approval and future delivery behavior.

## Do's and Don'ts

### Do:
- **Do** use the pale frame, white sheet and flat bordered panels for new workspace views.
- **Do** retain visible status words and source provenance next to evidence.
- **Do** use compact IBM Plex Sans hierarchy and tabular metrics.
- **Do** preserve visible keyboard focus and durable source selection.
- **Do** stack work regions on mobile and keep account actions reachable in Settings.

### Don't:
- **Don't** imply that imported evidence is already approved or published.
- **Don't** introduce ambient card shadows into this flat workspace.
- **Don't** replace the compact dashboard hierarchy with oversized marketing typography.
- **Don't** describe this implementation as a user-approved image comp or a completed Impeccable visual selection process.

---

# Scoped Design System: `/landing`

## Overview

This section applies only to the local `/landing` marketing surface. The dashboard system and its frontmatter above remain authoritative for the workspace. Landing styles are scoped under `.lp`; reusable landing components and the graphics layer live separately in `utils/landing/`.

The current implementation is an **initial approximation**, not an exact clone of the Emotion reference. It pairs an original procedural violet landscape with large serif statements and an illustrative workflow preview. No public landing page has been deployed. No original artwork, models, textures, proprietary fonts, or audio from the reference are borrowed for the implementation. The research inventory in `docs/LANDING_PAGE_REFERENCE.md` is reference material; its proposed effects are not a claim that those effects have shipped.

Desktop screenshot verification remains incomplete. The implementation details below are extracted from current source and do not establish a completed visual-fidelity comparison.

## Colors

These route-local CSS tokens are defined in `utils/landing/landing.css` and do not replace dashboard tokens:

| Token | Value | Use |
| --- | --- | --- |
| `--lp-paper` | `#f5efff` | Pale lavender content ground and light footer text |
| `--lp-ink` | `#2a1647` | Content text, selected workflow tab, footer ground |
| `--lp-purple` | `#9047ff` | Accent vocabulary; selection currently uses the same literal value |

Scene chapters use white text over the landscape and a dark lower gradient. The workflow inset uses `#e6daf3`; the illustrative product panel uses `#fcfaff`. Scene materials form a separate purple lighting palette rather than semantic dashboard states.

## Typography

**Display:** Cormorant Garamond, serif fallback, weight 300, upright and italic emphasis. Headlines use `-.035em` tracking and `.92` line-height. The current desktop hero uses `clamp(60px, 6.7vw, 108px)`; section headings use `clamp(48px, 6.6vw, 104px)`. Italic introductory phrases contrast with upright statements.

**Body and controls:** IBM Plex Sans, sans-serif fallback, with a 16px route base and 1.6 line-height on supporting paragraphs. Small workflow numbering uses IBM Plex Mono at 11px. Cormorant is a deliberate alternative to the reference's proprietary display face; its metrics and wrapping are not identical.

## Layout

Three viewport-height text chapters share a sticky `100svh` landscape. An additional 55svh story tail gives the circular scene exit room to expand; reduced motion removes that tail and hides the portal. Desktop page margins are 3.4%; the hero headline is asymmetrical, followed by left- and right-aligned chapter copy. The pale workflow section rounds into the scene and uses a two-column preview (1fr / 1.4fr). Principles and footer also use two columns.

At 1024px and below, navigation becomes a fixed bottom-centered dock, at most 350px wide, with an expandable panel above it. Controls move above the dock and footer bottom padding grows to 160px. At 1000px, the hero stacks and demo spacing tightens. At 760px, page margins become 20px, and workflow, principles and footer stack. The phone hero uses `clamp(46px, 12vw, 62px)` and chapter headings use `clamp(42px, 12vw, 60px)`. These are implemented landing breakpoints, not the reference's measured breakpoints.

## Elevation & Depth

Landscape depth comes from Three.js perspective, fog, lighting, reflective Water and additive particles. Glass actions use translucent gradients, a bright inset rim and 12px backdrop blur. The illustrative product sheet rotates -3deg (-2deg on mobile) with a soft `0 25px 60px #40246020` shadow. These marketing treatments are scoped to `/landing`; the dashboard remains flat.

## Shapes

Actions and workflow tabs use pill forms. The workflow section has 40px upper corners, the demo inset a 24px radius, and the product preview a 12px radius. The scene combines continuous faceted terrain, tapered curved grass blades, a tubular architectural arch and a luminous particle P. The mobile dock has a 36px radius and its menu panel a 24px radius.

## Components

- `LandingPage.tsx` composes the page and exports `LandingAction`, `LandingNavigation`, `WorkflowPreview` and `LandingFooter`. Workspace actions link to `/`.
- `Landscape.tsx` is dynamically loaded client-side. Original generated geometry and a generated normal texture feed Three.js Water; a shader morphs the particle P toward a sphere as story scroll progress changes. This is a limited original scene, not the reference's complete environment or camera choreography.
- `scenery.ts` generates a continuous river valley, instanced curved grass ribbons (14,000 high / 5,000 low quality) and a dark metallic arch with moderate reflectivity. All geometry is generated locally; no reference scene assets are imported.
- `StoryMotion.tsx` uses GSAP ScrollTrigger for scrubbed hero rise/skew/fade, staggered chapter text entrances and an expanding paper-colored circular exit (`circle(0%)` to `circle(150%)`). Its GSAP context reverts on cleanup or when reduced motion is enabled, restoring readable static content. This CSS clip-path transition approximates the reference's exit; it does not reproduce its custom noise effects.
- `WorkflowPreview` presents Collect, Review and Approve as an illustrative HTML panel, not real product screenshots or a live import operation. Tabs expose selection and support arrow keys, Home and End.
- `LandingAction` has a minimum height of 46px, a 200ms background/transform transition and a 2px upward hover movement. Keyboard focus uses a 2px current-color outline with 6px offset.
- Lenis smooths scrolling when motion is enabled. Reduced-motion preference initializes the motion state; a visible pause/enable control can override it. Paused motion fixes scene time and progress and disables Lenis; CSS suppresses transitions under the system reduced-motion preference. Low quality reduces particles, grass, reflection resolution and pixel ratio. Rendering skips hidden/offscreen frames; a CSS landscape remains when WebGL is unavailable. These are implemented safeguards, not measured frame-rate guarantees.
- A skip link goes to product details. Mobile navigation exposes expanded state; Escape within the navigation closes the panel and returns focus to Menu. Quality/motion buttons expose pressed state.

## Do's and Don'ts

- **Do** preserve the violet palette, light serif/italic contrast, scene-led opening and clear entry into the workspace within this route.
- **Do** keep landing styles and heavy graphics isolated in `utils/landing/` and preserve dashboard styling.
- **Do** keep evidence collection, review, approval and export claims faithful to implemented behavior.
- **Don't** label this initial approximation an exact reproduction, a completed reference-fidelity pass or a publicly deployed page.
- **Don't** reuse inventoried reference artwork without appropriate rights, or imply the illustrative preview is a real product capture.
- **Don't** describe unimplemented audio, image distortion or a conversational assistant as existing features, or equate the implemented circular exit with exact reference fidelity.
