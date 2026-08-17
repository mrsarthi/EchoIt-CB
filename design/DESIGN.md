# EchoIt Visual Design System

This document defines the visual design system for **EchoIt**, a local-first, privacy-respecting messenger. The design is optimized for webviews (React 19 + TypeScript in Tauri v2) targeting mobile (iOS/Android) and desktop platforms.

---

## 1. Aesthetic Rationale: "The Warm Paper Journal"

EchoIt deliberately moves away from the cold, high-tech, cyberpunk aesthetic typical of encrypted apps. It does not want to feel like a hacker's terminal or a military command center. 

Instead, our aesthetic is modeled after a **physical paper notebook or personal journal**:
*   **Tactile and Human**: Warm ivory/sand backdrops instead of blinding whites or harsh blue-blacks.
*   **Low Cognitive Load**: Quiet, low-saturation earth tones that reduce eye strain and encourage calm, unhurried messaging.
*   **Paper Layers**: We use thin outlines and subtle tonal shifts to indicate structural layers, rather than heavy, floating dropshadows.

---

## 2. Color System & Accessibility

Accessibility is a core requirement, not an afterthought. Every primary text-to-background pairing is calculated to meet or exceed the **WCAG 2.1 AAA** contrast standards (minimum **7:1** ratio for body text). Accent pairings meet **WCAG 2.1 AA** standards (minimum **4.5:1** ratio).

### Relative Luminance Formula
Relative luminance ($L$) is calculated from linearized sRGB components:
$$L = 0.2126 \times R_{\text{linear}} + 0.7152 \times G_{\text{linear}} + 0.0722 \times B_{\text{linear}}$$
Where contrast ratio ($CR$) is:
$$CR = \frac{L_{\text{light}} + 0.05}{L_{\text{dark}} + 0.05}$$

---

### Light Theme: "Warm Sand & Charcoal Ink"

Designed for daylight reading, evoking physical parchment paper and dark charcoal ink.

| Token Name | Hex | Luminance ($L$) | Purpose |
| :--- | :--- | :--- | :--- |
| `--color-bg` | `#FAF6F0` | `0.9235` | App canvas background (warm cream) |
| `--color-surface` | `#FFFFFF` | `1.0000` | Input boxes, active cards |
| `--color-surface-dim` | `#F0EAE1` | `0.8173` | Unpaired chat cells, secondary panels |
| `--color-text` | `#1F2421` | `0.0170` | Primary reading text (charcoal ink) |
| `--color-text-muted` | `#506570` | `0.1209` | Time stamps, secondary labels (slate) |
| `--color-border` | `#E0D9CD` | `0.7024` | 1px border lines and grid divisions |
| `--color-primary` | `#9E492B` | `0.1094` | Primary brand accent (warm clay/rust) |
| `--color-success` | `#226040` | `0.0907` | Fully paired connection states (pine green) |
| `--color-warning` | `#B54831` | `0.0984` | Unilateral pairing alerts (terracotta) |

#### Contrast Ratio Verifications (Light Theme):
*   **Primary Readability**: Charcoal Ink (`#1F2421`) on Warm Sand (`#FAF6F0`):
    $$CR = \frac{0.9235 + 0.05}{0.0170 + 0.05} = \frac{0.9735}{0.0670} = \mathbf{14.53:1} \quad (\text{Passes AAA } \ge 7:1)$$
*   **Muted Readability**: Muted Slate (`#506570`) on Warm Sand (`#FAF6F0`):
    $$CR = \frac{0.9235 + 0.05}{0.1209 + 0.05} = \frac{0.9735}{0.1709} = \mathbf{5.70:1} \quad (\text{Passes AA } \ge 4.5:1)$$
*   **Primary Accent**: Warm Cedar (`#9E492B`) on Warm Sand (`#FAF6F0`):
    $$CR = \frac{0.9235 + 0.05}{0.1094 + 0.05} = \frac{0.9735}{0.1594} = \mathbf{6.11:1} \quad (\text{Passes AA } \ge 4.5:1)$$
*   **Bilateral connection state**: Pine Green (`#226040`) on Warm Sand (`#FAF6F0`):
    $$CR = \frac{0.9235 + 0.05}{0.0907 + 0.05} = \frac{0.9735}{0.1407} = \mathbf{6.92:1} \quad (\text{Passes AA } \ge 4.5:1)$$

---

### Dark Theme: "Soft Obsidian & Muted Paper"

Designed for night reading. It avoids harsh, high-contrast pure black (`#000000`) in favor of a soft, deep ink-charcoal that maintains tactile depth.

| Token Name | Hex | Luminance ($L$) | Purpose |
| :--- | :--- | :--- | :--- |
| `--color-bg` | `#171916` | `0.0094` | App canvas background (deep ink-charcoal) |
| `--color-surface` | `#212421` | `0.0170` | Input boxes, active cards |
| `--color-surface-dim` | `#1E201D` | `0.0139` | Unpaired chat cells, secondary panels |
| `--color-text` | `#EAE6DF` | `0.7901` | Primary reading text (muted paper) |
| `--color-text-muted` | `#A39E93` | `0.3325` | Time stamps, secondary labels (warm gray) |
| `--color-border` | `#333732` | `0.0385` | 1px border lines and grid divisions |
| `--color-primary` | `#E08560` | `0.2853` | Primary brand accent (soft terracotta/clay) |
| `--color-success` | `#5C9E7B` | `0.2736` | Fully paired connection states (soft pine) |
| `--color-warning` | `#D6765E` | `0.2319` | Unilateral pairing alerts (terracotta) |

#### Contrast Ratio Verifications (Dark Theme):
*   **Primary Readability**: Muted Paper (`#EAE6DF`) on Soft Obsidian (`#171916`):
    $$CR = \frac{0.7901 + 0.05}{0.0094 + 0.05} = \frac{0.8401}{0.0594} = \mathbf{14.14:1} \quad (\text{Passes AAA } \ge 7:1)$$
*   **Muted Readability**: Warm Gray (`#A39E93`) on Soft Obsidian (`#171916`):
    $$CR = \frac{0.3325 + 0.05}{0.0094 + 0.05} = \frac{0.3825}{0.0594} = \mathbf{6.44:1} \quad (\text{Passes AA } \ge 4.5:1)$$
*   **Primary Accent**: Soft Clay (`#E08560`) on Soft Obsidian (`#171916`):
    $$CR = \frac{0.2853 + 0.05}{0.0094 + 0.05} = \frac{0.3353}{0.0594} = \mathbf{5.64:1} \quad (\text{Passes AA } \ge 4.5:1)$$
*   **Bilateral connection state**: Soft Pine (`#5C9E7B`) on Soft Obsidian (`#171916`):
    $$CR = \frac{0.2736 + 0.05}{0.0094 + 0.05} = \frac{0.3236}{0.0594} = \mathbf{5.45:1} \quad (\text{Passes AA } \ge 4.5:1)$$

---

## 3. Typography Scale

Our typography matches the journal aesthetic: **elegant serif headings** paired with **neutral, highly legible body text** and **monospaced codes** for technical actions (like pairing keys).

### Font Families
*   **Headline Font**: `Literata` (CSS: `"Literata", "Georgia", serif`). A warm, human-oriented serif designed specifically for reading on screens. It gives header text an editorial, unhurried voice.
*   **Body Font**: `Geist` (CSS: `"Geist", "Inter", sans-serif`). A highly legible, contemporary sans-serif with a clean structure that keeps the interface responsive and legible at small sizes.
*   **Label/Mono Font**: `JetBrains Mono` (CSS: `"JetBrains Mono", monospace`). Used for security addresses (`did:key`), numeric pairing codes, and ticket exports to distinguish data from human conversation.

### Font Sizes (Modular Scale: 1.25x Major Third)
Using a 1.25x Major Third modular scale for clear hierarchy:

```
Label/Mono (12px) ── Body-Sm (14px) ── Body-Rg (16px) ── H3 (20px) ── H2 (25px) ── H1 (31px)
```

| Token | Size | Line Height | Case/Tracking | Application |
| :--- | :--- | :--- | :--- | :--- |
| `--font-h1` | `1.9375rem` (31px) | `1.2` | Normal / `-0.02em` | Main titles, profile name headers |
| `--font-h2` | `1.5625rem` (25px) | `1.25` | Normal / `-0.01em` | Section headings, list divisions |
| `--font-h3` | `1.25rem` (20px) | `1.3` | Normal / `0` | Dialog headers, name in chat list |
| `--font-body` | `1.0rem` (16px) | `1.5` | Normal / `0` | Message bubbles, description text |
| `--font-body-sm` | `0.875rem` (14px) | `1.45` | Normal / `0.01em` | Subtext, system instructions |
| `--font-label` | `0.75rem` (12px) | `1.4` | UPPERCASE / `0.05em` | Metadata headers, column names |
| `--font-mono` | `0.8125rem` (13px) | `1.5` | Normal / `0` | `did:key` values, ticket payloads |

---

## 4. Spacing Scale

Our spacing system is based on a **4px baseline**, expanding logically to manage content density. 

```
xs (4px) ── sm (8px) ── md (12px) ── lg (16px) ── xl (24px) ── 2xl (32px) ── 3xl (48px) ── 4xl (64px)
```

*   **`--space-xs` (`4px`)**: Smallest margins (e.g., separating timestamp from message text).
*   **`--space-sm` (`8px`)**: Inner padding for items inside elements (e.g., buttons, avatar to name).
*   **`--space-md` (`12px`)**: Padding for chat bubbles, list item gaps.
*   **`--space-lg` (`16px`)**: Standard screen padding for panels, outer margins on mobile.
*   **`--space-xl` (`24px`)**: Desktop screen margins, spacing between chat sections.
*   **`--space-2xl` (`32px`)**: Grid gaps, large panel padding.
*   **`--space-3xl` (`48px`)**: Spacing for empty-state splash screens, setup cards.
*   **`--space-4xl` (`64px`)**: Top/bottom offsets for mobile viewports.

---

## 5. Radii (Shapes)

Following the paper card metaphor, shapes have **soft, structural roundness** to feel safe and approachable, yet geometric enough to represent a reliable tool.

*   **`--radius-sm` (`4px`)**: Subtle rounding (e.g., system alert boxes, indicators).
*   **`--radius-md` (`8px`)**: Standard buttons, input text fields, inner cards.
*   **`--radius-lg` (`16px`)**: Chat bubbles (incoming/outgoing), primary page sheets, modals.
*   **`--radius-full` (`9999px`)**: Profile avatars, status indicators, pill buttons.

---

## 6. Elevation & Shadows

We treat shadows with extreme restraint, mimicking a flat sheet of paper sitting on another sheet. We avoid glowing, colored drop shadows.

*   **`--shadow-flat` (`none`)**: Zero shadow. Elements are separated purely by a `1px` border of color `--color-border`. (Default state for cards, lists).
*   **`--shadow-low` (`0 1px 2px rgba(31, 36, 33, 0.05)`)**: Used for message bubbles to lift them slightly off the background canvas.
*   **`--shadow-high` (`0 8px 24px -4px rgba(31, 36, 33, 0.08)`)**: Used for menus, sheets, and pairing modal cards to establish prominent depth.

*In dark mode, shadows swap to a slightly darker, larger-spread alpha: `--shadow-low-dark` (`0 1px 2px rgba(0, 0, 0, 0.2)`), `--shadow-high-dark` (`0 8px 24px -4px rgba(0, 0, 0, 0.4)`).*

---

## 7. Motion & Transitions

Animations are quiet, smooth, and physically motivated. We avoid bouncy, playful, or rapid movements.

*   **Timing Function**: `cubic-bezier(0.16, 1, 0.3, 1)` (easeOutExpo). This provides a quick, smooth transition that settles gently.
*   **Standard Duration**: `--motion-duration-sm` (`150ms`) for color fades, button states. `--motion-duration-md` (`300ms`) for screen slide-ins, drawer openings.
*   **Micro-Interaction (Scale)**: Active interactive controls (like the ticket action button) should slightly scale down (`transform: scale(0.97)`) on click and rebound smoothly.
