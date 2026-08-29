# Design Skills: Commands & Rules Reference

This document summarizes the core commands, principles, and rules from your two new AI design skills: **Design Taste Frontend** (`design-taste-frontend`) and **Impeccable** (`impeccable`).

---

## 1. Impeccable (`impeccable`)
**Purpose:** Out-of-distribution craft. Treats every design task as an award-winning design director. Covers UI/UX, redesigns, polishing, audits, and more.

### 🌟 Most Important Commands
*(You can use these keywords/commands in your prompts to trigger specific workflows)*

- **`shape [feature]`**: Plan UX/UI before writing code. Crucial for getting the architecture right before implementing.
- **`critique [target]`**: UX design review with heuristic scoring. Let the AI roast your design to find flaws.
- **`polish [target]`**: Final quality pass before shipping. Fixes alignment, spacing, typography, and micro-interactions.
- **`bolder [target]`**: Amplifies safe or bland designs. Use this if a design feels "too boring" or generic.
- **`quieter [target]`**: Tones down aggressive or overstimulating designs. Use this if a design feels "too loud" or messy.

### Secondary Commands
- **`init`**: Capture durable product context in PRODUCT.md.
- **`document`**: Generate DESIGN.md from existing project code.
- **`extract [target]`**: Pull reusable tokens and components into a design system.
- **`audit [target]`**: Technical quality checks (accessibility, performance, responsiveness).

### 📐 Key Principles
- **The Brief Wins:** Eure Vorgaben (Farben, Fonts, Vibe) überschreiben immer den Standard-Geschmack der KI.
- **Contextual Modes:** Die KI unterscheidet strikt, ob eine Seite *überzeugen* (Landing Page), *bedient werden* (Dashboard, wie PassSafer), *gelesen werden* (Dokus) oder *erlebt werden* (Portfolio) soll.
- **No LLM Defaults:** Absolutes Verbot von "AI Slop" (z.B. lila Farbverläufe, zentrierte Texte über dunklem Hintergrund, sinnlose Endlos-Animationen).

---

## 2. Design Taste Frontend (`design-taste-frontend`)
**Purpose:** Anti-slop frontend skill specifically tailored for making interfaces look premium and non-templated.

### 🌟 The "Three Dials" (Core Configuration)
When starting a design task, you can explicitly ask the AI to set these dials to guide the style:
- **`DESIGN_VARIANCE` (1-10)**: 1 = Perfect Symmetry (Clean/Corporate), 10 = Artsy Chaos (Awwwards style).
- **`MOTION_INTENSITY` (1-10)**: 1 = Static, 10 = Cinematic / Physics (Heavy Animations).
- **`VISUAL_DENSITY` (1-10)**: 1 = Art Gallery / Airy, 10 = Cockpit / Packed Data (Like a dense dashboard).

### 🚫 Forbidden Patterns (AI Tells)
This skill strictly bans common AI design mistakes:
- **Visual & CSS:** Generic glassmorphism on *everything*, excessive box-shadows.
- **Typography:** Overuse of Em-Dashes (—), Inter font as a lazy default.
- **Layout:** Three perfectly equal feature cards under a centered hero text.
- **Content:** Generic "Jane Doe" placeholder text.

### Redesign Protocol (How it works on PassSafer)
- **Audit Before Touching:** The AI must inspect existing code and tokens first.
- **Preservation Rules:** Don't destroy functionality for the sake of aesthetics.
- **Targeted Evolution vs. Full Overhaul:** The AI decides whether to just modernize components (what we did with the Dashboard) or rewrite the whole logic.
