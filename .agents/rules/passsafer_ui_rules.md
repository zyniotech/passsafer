---
trigger: always_on
---

# PassSafer UI & Codebase Invariants

## 1. Button Hover & Motion Constraints
- **Zero Layout Shifts**: Never add dynamic borders on `:hover` that alter element box dimensions. Buttons must maintain `border: 1px solid transparent; box-sizing: border-box;` or use `box-shadow` outline rendering.
- **Fill Preservation**: Do NOT strip or replace `background-color` on standard button hover. Only apply the outline border `border-color: #b3b3b3D9 !important;`.

## 2. Color Palette & Semantic System
- **Orange Ban**: The legacy accent color (`#FF8C00` / `var(--color-accent)`) is banned from card hover states, input focus rings, and button outlines.
- **Neutral Outlines**: Use `#b3b3b3D9` (85% alpha `#b3b3b3`) for card/input/button hover outlines.
- **Semantic Colors**:
  - **Success / Strong**: `#2ecc71` (Green)
  - **Warning / Weak / Reused**: `#f39c12` (Yellow)
  - **Danger / Leaked**: `#e74c3c` (Red)
- **Danger Zone Actions**: Buttons like "Delete Account" must use soft red backgrounds (`rgba(231, 76, 60, 0.1)`) with crisp `#e74c3c` borders.

## 3. List Entry Dimension Standard (56px)
- All list card items (Passwords, Credit Cards, IDs, Folders, Documents, Reports) must strictly maintain a height of `56px`.
- Layout must be minimalist: Left icon, vertically centered single-line title, right action/status badge. No secondary description subtitles underneath titles.

## 4. Dark Theme Native Controls
- Native form pickers (e.g. `<input type="date">`) must include `color-scheme: dark;` to prevent blinding white OS popups.
- Picker indicators must use white SVG icons from `../icons_new/` (e.g. `calendar_wihte.svg`).

## 5. HTML Screen Boundary Hygiene
- Every view screen container (`<div id="*-screen" class="screen hidden">`) must be strictly enclosed before the start of any subsequent screen.
- Verify tag balance after structural edits to prevent UI bleeding across login and authenticated screens.
