---
name: PortfolioAI
description: Lavender Paper Glass workspace for evidence, review and approval.
colors:
  ground: "#f5efff"
  surface: "#fffcff"
  text: "#2a1647"
  muted: "#695779"
  border: "#ddd0eb"
  accent: "#7937cf"
  active: "#e8d7ff"
  negative: "#9b254d"
  action: "#2a1647"
  control: "#b6a2cb"
  hover: "#f0e5ff"
  well: "#f5effb"
  selected: "#eee1ff"
  neutral: "#eee5f6"
  panel-glass: "#ffffffb8"
  sidebar-glass: "#ffffff9c"
  summary-glass: "#ffffffb3"
typography:
  headline:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
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
    fontSize: "36px"
    fontWeight: 500
rounded:
  badge: "6px"
  control: "10px"
  panel: "20px"
  sidebar: "28px"
  input: "9px"
  navigation: "12px"
  summary: "18px"
spacing:
  compact: "8px"
  control: "12px"
  inset: "16px"
  panel: "20px"
  grid: "24px"
  page: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "11px 17px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "10px"
  nav-active:
    backgroundColor: "{colors.active}"
    textColor: "{colors.text}"
    padding: "10px 12px"
    rounded: "{rounded.navigation}"
  panel:
    backgroundColor: "{colors.panel-glass}"
    rounded: "{rounded.panel}"
  badge:
    backgroundColor: "#eee5f6"
    textColor: "#695779"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  source-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "15px 20px"
---

# Design System: PortfolioAI

## Overview

The dashboard adapts the user's PaperGlass reference into a lavender and plum workspace with translucent paper surfaces, firm outlines, crisp offset shadows and practical IBM Plex Sans typography. Overview, Sources, Review, Versions and Settings remain the essential destinations. Summary values come from workspace data, without decorative analytics, team members or invented performance claims.

This record is extracted from utils/dashboard/dashboard.css, WorkspaceSidebar.tsx, SummaryCards.tsx, SourceList.tsx and app/workspace.tsx, with inherited styles in app/style.css. It makes no browser-inspection or screenshot-verification claim. These rules are scoped to .dashboard; landing and authentication retain separate surfaces.

The dashboard has one fixed light appearance. There is no Theme selector or theme-applying effect. Historical settings.theme remains backend data but no longer changes the dashboard or widget preview.

## Colors

Lavender ground supports plum text, outlines and primary actions. Purple accent marks focus, source selection, source-type tabs and unsaved changes. Active navigation uses lavender fill. Panels and sidebar use translucent white; inputs use a solid surface. Status always includes written text.

Notice uses #eee6fc / #51316e with #c9b1e7 border; failure uses #fff0f4 / #9b254d with #e9b9c9 border; success uses #e3f1e9 / #285c44. Selection uses #dfc6ff with plum text. Background washes #e5d3fd and #f7deef sit over the lavender ground.

## Typography

IBM Plex Sans carries headings, labels, controls, evidence and counts. Page headings are 34px/1.2 at weight 600, reducing to 30px at 1150px and 28px at 760px. Panel headings are 16px; profile-summary names use 27px with -.025em tracking. Body uses 14px and 1.6 line-height; evidence uses 1.7. Introductions are limited to 58ch. Summary counts use 36px tabular numerals, reduced to 30px on mobile. Version hashes remain monospace. Marketing serif headings do not enter working controls.

## Layout

The desktop shell has 24px padding, a 230px sticky sidebar and a flexible content column separated by 26px. Sidebar top offset is 24px and minimum height is viewport height minus 48px. Main content has a transparent surround, 44px top bar and 22px/4px/20px padding. Four summary buttons use 18px gaps; Overview pairs source and profile panels at 1.25fr / 1fr with 24px gaps, followed by full-width activity.

At 1150px sidebar width becomes 195px, shell padding 18px and gap 22px. Summary buttons become two columns; Overview and Settings stack. Inherited source/version adaptations also apply at 1100px. At 760px the sidebar becomes static with horizontally scrollable text navigation; account details disappear and sign-out remains in Settings. Shell padding is 12px, source rows wrap and Review/approval stack. Above 1600px side margins keep the composition near 1550px wide.

## Elevation & Depth

Paper Glass uses crisp offset shadows and dark outlines from the supplied reference. Sidebar: 2px plum border, 5px 6px 0 #2a1647 shadow, 16px blur. Panels: 1.5px plum border, 4px 5px 0 #ddd0ed shadow, 12px blur. Summary: 4px 4px 0 #d1bee6. Active navigation: 3px 3px 0 #2a1647. Primary actions: 3px 3px 0 #b99bd9. Source selection has a 3px purple inset edge. Focus retains a 2px accent outline with 3px offset.

## Shapes

Sidebar radius is 28px; panels 20px; summary buttons 18px; navigation 12px; buttons 10px; inputs 9px; badges 6px. Mobile uses 20px sidebar, 16px panels and 14px summary buttons. Source rows remain square inside clipped panels. The brand mark is a lowercase p in a plum rounded tile.

## Components

- **WorkspaceSidebar:** reusable overview/brand action, five navigation buttons, source count, unsaved-review marker, privacy note and sign-out. Active navigation exposes aria-current="page". Mobile keeps text labels with horizontal scrolling.
- **SummaryCards:** buttons show real connected-source, ready-import, draft-fact and approved-version counts, linking to the corresponding workspace view.
- **SourceList:** shared rows retain wrapping names, source kind, written job state and aria-pressed selection. Empty content explains how to add a source. Evidence stays separate from draft content.
- **Buttons and inputs:** buttons are generally at least 40px, navigation 46px and mobile controls 44px. Plum primary actions use 11px/17px padding and lighten on hover. Inputs use solid surfaces and visible labels. Disabled controls retain half opacity. Navigation and summary feedback takes 180ms; reduced-motion disables transitions.
- **Review and versions:** preserve provenance, editing, explicit save, approval acknowledgments, private exports and restore-to-draft behavior. Evidence remains internally scrollable.
- **Settings:** greeting, position, adapter, preview, privacy and account deletion remain available. Delivery history is inside the native Advanced disclosure in Settings, not Overview. Mock/disabled status is explicit; no live chatbot is implied.

## Do's and Don'ts

- **Do** use scoped lavender/plum tokens, translucent surfaces and Paper Glass outlines for workspace additions.
- **Do** retain real counts, provenance, written status and explicit approval.
- **Do** preserve keyboard focus, native disclosures and mobile navigation.
- **Don't** reintroduce dark/light controls or apply historical widget theme data to the website.
- **Don't** add fake charts, people or notification counts from the reference template.
- **Don't** treat source-derived documentation as a completed visual audit.

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
