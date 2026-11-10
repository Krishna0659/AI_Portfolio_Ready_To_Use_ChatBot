# PortfolioAI landing page — Emotion reference analysis

Inspected: 9 November 2026, Asia/Calcutta.
Reference: https://emotion-agency.com/?ref=refs.gallery
Scope: landing page only, as clarified by the user. Research and asset inventory are complete; a local implementation now exists at `/landing`. Hosting remains paused. Current verification and remaining fidelity work are tracked in `plan.md`.

## 1. Main finding

This is a custom real-time 3D experience combined with an editorial HTML page. Its defining features are a particle-built symbol, an animated landscape, a camera path controlled by scrolling, distorted typography and media, and carefully composed transitions between the 3D world and ordinary content.

A background video, stock photograph, or generic animation component would not reproduce the interactive result. The closest implementation needs a real scene, original assets, custom shaders, and a coordinated animation timeline.

The user's specific reference takes precedence over generic design-skill preferences: preserve its violet palette, serif/italic contrast, monospace captions, glass controls, and asymmetric composition.

## 2. Inspection coverage and limits

- Live homepage inspection from entry screen through landscape chapters, services, project gallery, awards, footer, and the next-page transition.
- Desktop viewport: 1440 × 900. Phone viewport: 390 × 844. An initial narrower browser view was also observed.
- Opened desktop settings, inspected quality choices, switched dark mode on and restored light mode, and opened/closed the phone menu.
- Opened the assistant interface to understand the floating orb; no message, microphone input, attachment, or contact form was submitted.
- Before the landing-only clarification, inspected About, Work, Contact, the E Promo and Sofia case-study templates, and legal pages live. Read the remaining project pages through web retrieval. This is not a claim that every project animation was interactively tested.
- Inspected loaded asset URLs, computed styles, the public entry stylesheet, and identifying strings in the shipped JavaScript.
- No frame-rate benchmark, GPU profile, exact camera-coordinate extraction, audio listening test, reduced-motion test, or exhaustive browser/accessibility audit was performed. Screenshots showed sampled motion states, not a timing-calibrated recording.

## 3. Landing-page sequence

| Stage | Observed presentation | What we need to reproduce |
| --- | --- | --- |
| Entry | Pale lavender loading screen, centered small wordmark, short caption, progress indicator, choice to enter with or without audio | Asset-aware loading progress, a useful poster fallback, optional audio unlocked by a click |
| Hero | Full-screen purple landscape, water reflections, angular distant mountains, foreground grass, drifting leaves/sparks, luminous particle symbol | WebGL scene, reflective water material, instanced vegetation, particle system, lighting and postprocessing |
| First story chapter | Camera travels closer to the symbol while large typography moves and distorts | Scroll-to-camera mapping; coordinated text opacity, position, and deformation |
| Further chapters | Camera passes a dark architectural structure and reaches a tree/seating area; particle configuration changes, including a heart-like form | Shared environment with staged camera positions and particle morph targets |
| Exit from 3D story | A bright expanding circular opening covers the landscape and reveals the pale content surface | Custom radial/noise transition synchronized with the end of the story |
| Services | Large serif statement on the left; animated service list on the right; text progressively gains contrast | Split-text reveal and a restrained cycling list |
| Showcase | Eight featured projects in an offset arrangement with unequal sizes; rounded image/video surfaces; visible bending/pixel/RGB distortion during movement | Responsive asymmetric grid; real product media; optional WebGL image treatment |
| Proof | Large headline, structured ruled rows, small counts, and a luminous 3D award element | PortfolioAI proof using verified capabilities or real examples, without copying agency award claims |
| Footer | Large serif closing message, glass CTA, compact link/contact columns | Product-specific closing CTA and real destinations |
| Beyond footer | Landscape returns; continued scrolling opens About | Observed reference behavior. Not required for our single landing page; end with the product CTA |

The landscape is continuous across the opening chapters. Treat it as one directed scene with chapter states, not a new canvas mounted for each section.

## 4. Measured visual system

| Token | Verified value or behavior |
| --- | --- |
| Light surface | `#f5efff` |
| Light text | `#2a1647` |
| Primary accent | `#9047ff` |
| Dark surface | `#121212` |
| Dark text | `#ffffff` |
| Display face | `Emotion Serif`, light/300, upright and italic files |
| UI/body face | `PP Neue Montreal`, medium/500 |
| Technical captions | `IBM Plex Mono`, medium/500 |
| Desktop hero heading | 96 px at 1440 px viewport |
| Phone hero heading | 46 px, 36.8 px line height at 390 px viewport |
| Desktop content margins | 48 px at 1440 px viewport |
| Intermediate margins | 32 px at widths up to 1024 px |
| Phone margins | 16 px at widths up to 640 px |
| Navigation breakpoint | Desktop header hidden at widths up to 1024 px; mobile dock takes over |

Typography is central to the resemblance: thin, tall, high-contrast serif capitals; italic introductory words; exceptionally tight display leading; small uppercase monospace labels; modest sans-serif controls. Font substitutions will change line wrapping and perceived density.

Desktop navigation has a wordmark at left, a short central link group, settings and audio controls, and a glass CTA at right. It remains available while navigating the scene and changes contrast over pale content. Phone navigation becomes a bottom-centered rounded dock containing menu, wordmark, and animated orb. Opening it expands into a tall rounded violet panel with links and settings; the page behind is dimmed.

The glass treatment combines translucent color, a bright rim, blur/refraction-like detail, and moving light. A plain semi-transparent rectangle will only approximate it.

## 5. Motion breakdown

| Motion system | Observed effect | Proposed implementation |
| --- | --- | --- |
| Ambient landscape | Water movement, drifting particles, animated foliage, changing sparkle | Time-based shader uniforms and an efficient render loop |
| Particle symbol | Dense luminous particles form the logo and other shapes | Sample original geometry into equal-length point arrays; interpolate targets in a shader |
| Camera journey | Scroll produces travel and framing changes rather than merely moving HTML upward | One normalized scroll progress value driving a camera spline and chapter timeline |
| Typography | Curved/skewed letters, colored fringes, movement-linked distortion | SplitText for DOM staging; custom displacement/RGB-separation treatment for closer fidelity |
| Media | Image edges warp and break into pixel-like strips during transitions | Plane geometry plus a custom shader, with normal image fallback |
| Text reveal | Characters/words progressively change from faint to dark | GSAP timeline linked to scroll progress |
| UI feedback | Animated arrows, pill highlights, opening menus, focus outlines | CSS transforms/opacity for simple states; GSAP for coordinated transitions |
| Assistant orb | Iridescent continuously moving sphere; expands into a large assistant view | Optional separate small shader canvas; a truthful demo or real product entry point |

Timings below are proposed starting values, not measurements extracted from the reference: 150–250 ms for control feedback, 450–700 ms for panel transitions, 600–1000 ms for section reveals. Camera pacing should be tuned by scroll distance and visual comparison, not a fixed autoplay duration.

## 6. Actual technology versus our dependency list

Confirmed from the loaded site:

- Nuxt/Vue: `/_nuxt/` bundles and Vue runtime code. The exact Nuxt major version of the agency site was not established; its case-study stack labels describe client projects.
- Three.js: `THREE.WebGLRenderer` implementation/error strings in the entry bundle.
- GSAP 3.14.2: explicit runtime version assignment.
- SplitText: implementation identifying string and version assignment in the same bundle.
- Lenis: implementation and scroll-handler references.
- Howler: audio implementation/integration references.
- Reka UI: DOM identifiers and collection/focus-management implementation references.
- Draco and Basis/KTX2 decoding: loaded JavaScript/WASM decoder assets; `.glb` models and `.ktx2` textures.
- Custom workers: `particleWorker-ys4WGYTu.js` and `tileWorker-gyiVipfF.js` were loaded.

ScrollTrigger strings occur in GSAP's core integration code, which alone does not prove the plugin drives this site's scenes. It is a suitable recommendation for our implementation, not a separately verified original dependency.

The studio also describes its preferred tools on its [About page](https://emotion-agency.com/about). Its privacy page discloses Vercel hosting, while asset URLs include Vercel image transformation. These observations do not alter our paused hosting decision.

For PortfolioAI, retain the existing Next.js/React/TypeScript application:

| Dependency | Decision | Purpose |
| --- | --- | --- |
| `three` | Required for this fidelity target | Landscape, particles, water, custom materials, loaders and rendering |
| `gsap` | Required | Coordinated motion; ScrollTrigger and SplitText from the same package |
| `@gsap/react` | Recommended | React lifecycle setup and animation cleanup |
| `lenis` | Recommended | Smooth scrolling synchronized with scene progress |
| `howler` | Optional | Add only if we include background audio and effects |
| `@types/three` | Development dependency | Type checking for Three.js integration |
| `@react-three/fiber`, `@react-three/drei` | Optional alternative | React scene authoring; not needed alongside a small direct Three.js scene controller |

The existing package manifest does not include these animation/rendering dependencies. No packages were installed during research. Resolve compatible current versions and pin them when implementation begins. React Three Fiber's documentation pairs v9 with React 19; do not select an alpha solely because it is newer.

Do not add Motion/Framer Motion, ZURB Motion UI, another smooth-scroll library, a carousel framework, or a CMS merely to mimic this page. GSAP plus Three.js covers the distinctive behavior. Reka is Vue-specific; use existing React controls or native semantic controls for our settings. Blender is a proposed authoring tool for original geometry, not a tool we verified the reference's creators used.

Primary documentation: [Three.js](https://threejs.org/docs/), [GSAP](https://gsap.com/docs/v3/), [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/), [Lenis](https://github.com/darkroomengineering/lenis), [Howler](https://howlerjs.com/), [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction).

## 7. Images, models, fonts, and sound inventory

Saved locally for reference: **21 images/textures and one stylesheet**, with zero download failures. Location: `.local/design-reference/emotion-2026-11-09/assets/`. `manifest.json` preserves origin URLs; `local-manifest.json` maps those assets to the durable local copies. These are reference materials, not production assets.

Observed source assets include:

| Category | Observed paths on `https://emotion-agency.com` | Build requirement |
| --- | --- | --- |
| Symbol | `/models/e.glb` | Original PortfolioAI symbol with suitable particle-sampling geometry |
| Environment | `/models/mountain.glb`, `/models/office.glb`, `/models/chair.glb`, `/models/duck.glb` | Original or licensed environment meshes; only the visible landing-scene elements are needed |
| Grass | `/grass_text/grassbushcc008.ktx2`, `grassbushcc005.ktx2`, `grassbushcc006.ktx2` | Alpha-cut vegetation textures and instanced geometry |
| Water | `/water_map.png`, `/water/Water_1_M_Normal.jpg`, `/water/Water_2_M_Normal.jpg`, `/noise.jpg` | Water normal/noise textures and reflection shader |
| Tree/leaf | `/_nuxt/aspen_color.Cpgr1Q0w.png`, `/_nuxt/fallLeaf.DlVBl2Oz.png` | Tree foliage and falling-leaf sprites |
| Project videos | `/projects/e-promo.mp4`, `/projects/flshfrm.mp4` | Two short PortfolioAI workflow demonstrations with poster images |
| Project imagery | `/projects/sofia-thumb.webp`, `coco-thumb.webp`, `smp-fnnc-thumb.webp`, `ksh-thumb.webp`, `aura-thumb.webp`, `kairos-thumb.webp`, plus other gallery thumbnails | Real PortfolioAI product captures or authorized portfolio examples |
| Display fonts | `/fonts/EmotionSerif-Light.woff2`, `/fonts/EmotionSerif-LightItalic.woff2` | License/permission for exact fonts, or a deliberately chosen alternative |
| Other fonts | `/fonts/PPNeueMontreal-Medium.woff2`, `/fonts/IBMPlexMono-Medium-Latin1.woff2` | Appropriate font distribution rights |
| Ambient audio | `/audio/background/webm/main.webm`, `lofi_loop.webm`, `projects.webm` | Optional original/licensed ambient loop |
| Audio effects | `/audio/effects/webm/transition.webm`, `typing.webm`, `boom.webm`, `dial.webm`, `knob_tick.webm` | Optional subtle original/licensed interaction sounds |

The asset tool classifies WebM audio containers as video; their `/audio/` paths and sound-library integration identify their role. Models, fonts, and sound were inventoried, not added to our application.

Exact reproduction depends on geometry, materials, lighting, font metrics, and timing—not just installing the same packages. The reference's [terms](https://emotion-agency.com/legal/terms-of-service) reserve rights in its creative assets. Use the saved material to study the composition; use original or appropriately licensed assets in the implementation. No license for production reuse was established.

## 8. PortfolioAI landing-page build brief

Keep the same visual language and scene-led structure, with content that accurately represents PortfolioAI:

1. Hero: original particle symbol over a violet landscape; a short product statement and a visible action into the existing product.
2. Scroll chapter: bring together website, GitHub, and document-source motifs. Show ingestion as evidence collection, not an automatic claim of truth.
3. Scroll chapter: particle arrangement resolves into a profile representation; explain user review and explicit approval.
4. Exit transition: luminous circular opening reveals actual product UI.
5. Showcase: asymmetric real screenshots of import, evidence review, profile editing, approval/version history, and export. Match the reference's media scale and motion.
6. Proof: verified current capabilities and useful examples. Avoid invented customer counts, awards, testimonials, or live RAG claims.
7. Footer: product CTA, sign-in, relevant internal anchors, and existing policy links. No separate agency project gallery, About experience, inquiry workflow, or scroll-to-next-route system is needed.

An animated orb can visually fit the concept, but the plan currently describes only a non-conversational preview. It must not imply a working public conversational assistant before that exists.

## 9. Implementation order and acceptance

1. Establish fonts, colors, responsive grid, real copy, and the semantic HTML landing page.
2. Build the hero scene at desktop and phone sizes: symbol, water, grass, mountains, light and camera framing. Get a convincing still before extending the journey.
3. Add particle morph targets and scroll-linked camera chapters; keep one owner of the animation/render loop.
4. Add the exit transition, actual product media, text reveals, image effects, navigation and CTA states.
5. Add optional sound only after the silent experience works. Implement low-quality rendering, reduced-motion and non-WebGL fallbacks.
6. Compare local screenshots at 1440, 768 and 390 px; inspect each chapter at several scroll positions. Check slow asset loading, route cleanup, keyboard operation, focus return, touch scrolling, and browser history.
7. Measure performance on real hardware. Proposed targets are smooth 60 fps desktop interaction and a usable low-quality mobile mode; these are targets, not reference-site measurements.

Use a client-only, dynamically loaded graphics layer over server-rendered content. Dispose of geometry, materials, textures, listeners and animation contexts on teardown. Pause offscreen/inactive rendering, limit pixel ratio, lower particle and reflection quality on constrained devices, and keep useful text visible if rendering fails. Keep the heavy marketing graphics out of authenticated dashboard bundles.

The first implementation milestone should be a locally reviewable hero plus its first scroll transition. It validates the hardest visual requirement before extending the same scene through the rest of the landing page. All subsequent work remains local until the project's release/hosting conditions are met.
