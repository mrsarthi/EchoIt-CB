# EchoIt Visual Design System & UX Specification

This document defines the visual design system and UX architecture for **EchoIt**, a local-first, end-to-end encrypted messenger built for everyday humans.

---

## 1. Aesthetic Rationale: "The Warm Tactile Journal"

EchoIt rejects both cold cyberpunk encryption aesthetics and generic corporate SaaS dashboards in favor of **analog tactile serenity**:
*   **Paper Layering**: Visual hierarchy is created through delicate 1px structural borders and subtle tonal contrast rather than heavy floating drop shadows.
*   **Serene Dual Palette**: A daylight parchment palette (*"Warm Sand & Charcoal Ink"*) paired with a deep reading night palette (*"Soft Obsidian & Muted Paper"*).
*   **Conversational Focus**: Generous whitespace, elegant typography, and quiet connection badges that put human conversation at the center.

---

## 2. Screen Architecture & Navigation Rules

### A. Home Screen Navigation Shell (Bottom Navigation Bar)
The persistent 4-tab bottom navigation bar exists **ONLY** on the main Home Page / Conversations Hub screen (never inside an active chat):
1. **Chats** (Default): Active conversation threads, unread counts, and connection status.
2. **Contacts**: Paired peer list, pending incoming requests, safe address exchange.
3. **Settings**: Hardware keychain status, theme switcher (Light / Dark / System), notification preferences, session lock & reset.
4. **Profile**: Your Safe Address (`did:key`), connection ticket QR exporter, 12-word recovery phrase backup viewer.

### B. 1:1 Direct Chat Screen (Full-Height View without Footer)
When a conversation is opened, the bottom tab navigation is hidden and replaced exclusively by the **Message Composer Bar**:
*   **Header Bar**:
    *   Back navigation button ($\ge 44\times 44\text{px}$) to return to the Home/Chats list.
    *   Contact display name with live verified connection dot (Pine `#226040` / Jade `#5C9E7B`).
    *   Security indicator: Peer verification status with bilateral pairing lock icon.
*   **Message Stream**:
    *   **Incoming Message**: Crisp paper surface (`#FFFFFF` in light, `#212421` in dark) with 1px border (`#E0D9CD` / `#333732`) and directional tail (`16px 16px 16px 4px`).
    *   **Outgoing Message**: Warm terracotta tint (`#F6EBE5` in light, `#2C201A` in dark) with directional tail (`16px 16px 4px 16px`).
    *   **Delivery Receipts**: `Staged` $\rightarrow$ `Sent` $\rightarrow$ `Delivered` $\rightarrow$ `Read`.
        **`PRODUCT.md` §5b is the authority here** — it defines the signals (grey
        tick in a ring for Sent; the recipient's picture desaturated for
        Delivered, full colour for Read) and the rules about `Staged` and about
        receipts being switched off. Do not restate the ladder here; it drifted
        once already.
*   **Bottom Composer Bar**:
    *   Rounded tactile paper input pill.
    *   Attachment button (`+` / paperclip).
    *   Terracotta send button (`#9E492B` / `#E08560`) with micro-scale press transition.


### C. Wide Layout — Desktop (WhatsApp Web / Telegram 3-Zone Architecture) *(updated 2026-08-21)*

EchoIt ships to Windows as well as mobile devices (Android/iOS). This section defines the desktop layout.

**Switch on window width, never on operating system.** A desktop window dragged narrow (< 840px) gets the clean mobile layout. **Breakpoint: `840px`.**

#### The 3-Zone Desktop Architecture (WhatsApp Web Style)

On wide screens, the mobile bottom navigation bar is completely removed and replaced with a dedicated **Far-Left Vertical Navigation Rail**, freeing 100% of the sidebar height for conversation lists and content:

```
┌──────┬────────────────────────┬───────────────────────────────────────────┐
│ RAIL │ SIDEBAR (340px)        │ MAIN CONVERSATION PANE (Flex 1)           │
│ (56px│                        │                                           │
├──────┼────────────────────────┼───────────────────────────────────────────┤
│ [🛡️] │ Chats                  │ 👤 Alice                                  │
│ Brand│ [ 🔍 Search...      ]  ├───────────────────────────────────────────┤
│      │                        │                                           │
│ [💬] │ 💬 Alice               │   ┌───────────────────────────────────┐   │
│ Chats│    "See you tomorrow"  │   │ Hey, let's catch up later today!  │   │
│      │                        │   └───────────────────────────────────┘   │
│ [👥] │ 💬 Bob                 │                                           │
│People│    "Connected directly"│                                           │
│      │                        │                                           │
│      │                        │                                           │
│      ├────────────────────────┤                                           │
│ [⚙️] │ (Full vertical height, │ ┌───────────────────────────────────┬───┐ │
│ [👤] │  no mobile bottom bar) │ │ Type a message...                 │ ➤ │ │
└──────┴────────────────────────┴─┴───────────────────────────────────┴───┴─┘
```

| Zone | Width / Role | Layout & Contents |
| :--- | :--- | :--- |
| **1. Far-Left Nav Rail** | `56–64px` | Full-height recessed strip (`--color-surface-dim`).<br>• **Top Group**: EchoIt shield badge, Chats icon (`<ShieldIcon size={20} />`), Contacts icon (`<AddressBookIcon size={20} />`).<br>• **Bottom Group**: Settings gear (`<SettingsIcon size={20} />`), Profile avatar disc (`<UserIcon size={20} />`).<br>• Active state indicated by clay pill tint (`--color-primary-subtle`) and active icon color (`--color-primary`). |
| **2. Active Sidebar** | `320–380px` (Default `340px`) | Displays the active destination at full vertical height with 1px border (`--color-border`).<br>• **Chats**: Search, filter, full conversation list.<br>• **Contacts**: Add Contact button, search, Connection Requests knocks, paired contacts.<br>• **Settings / Profile**: Clean configuration and identity views. |
| **3. Main Workspace** | `flex: 1` | • **When chat open**: 1:1 conversation view (`ChatView`) with header, security indicator, message stream, and composer.<br>• **When resting**: Tactile journal resting screen with subtle shield icon and quiet welcome copy. |

#### Layout Comparison by Screen Width

| | Narrow (`< 840px`) | Wide (`>= 840px` — WhatsApp Style) |
| :--- | :--- | :--- |
| **Navigation** | Bottom tab bar (Home screen only; hidden in chat) | **Far-Left Nav Rail (56px)** permanent across all tabs |
| **Sidebar** | Full-width modal views | **Dedicated Left Column (340px)** with 100% vertical height |
| **Chat View** | Full-screen replacement (`onBack` returns to list) | **Simultaneous Right Pane** (Conversation & list visible together) |
| **Resting State** | Empty conversation list | Warm paper notebook resting stage in main pane |

#### Desktop Ergonomics & Interactions

*   **Keyboard Shortcuts**: `Enter` sends message, `Shift+Enter` inserts newline, `Escape` deselects open conversation or closes modals, `ArrowUp`/`ArrowDown` navigates conversation list.
*   **Hover States**: Subtle tonal lift on conversation cards and rail icon buttons (`--color-surface-dim` / `--color-primary-subtle`); never the sole indicator for any status.
*   **Touch & Click Targets**: $\ge 44\times 44\text{px}$ clickable areas preserved for touch laptop compatibility.
*   **Window Chrome**: Native OS title bar for robust dragging, snapping, and maximizing.

---

## 3. Color Palettes & Verified Accessibility

All color pairings are mathematically verified to exceed **WCAG 2.1 AAA** ($\ge 7:1$) for body text and **WCAG 2.1 AA** ($\ge 4.5:1$) for interactive elements.

### Light Palette: "Warm Sand & Charcoal Ink" (Default)
| Token | Hex Value | Purpose & Application | Contrast on `--color-bg` |
| :--- | :--- | :--- | :--- |
| `--color-bg` | `#FAF6F0` | Main canvas (Warm Sand Parchment) | Base canvas |
| `--color-surface` | `#FFFFFF` | Incoming paper bubbles, input background | Elevated paper sheet |
| `--color-surface-dim` | `#F0EAE1` | Home bottom nav bar background, secondary panels | Recessed structural layer |
| `--color-text` | `#1F2421` | Body reading text (Charcoal Ink) | **14.64:1** (AAA $\ge 7:1$) |
| `--color-text-muted` | `#506570` | Timestamps, inactive nav labels (Slate) | **5.68:1** (AA $\ge 4.5:1$) |
| `--color-border` | `#E0D9CD` | 1px border lines and division rules | Delicate structure |
| `--color-primary` | `#9E492B` | Send button, active nav icon (Clay Rust) | **5.67:1** (AA $\ge 4.5:1$) |
| `--color-primary-subtle` | `#F6EBE5` | Outgoing message bubbles | Soft contextual tint |
| `--color-success` | `#226040` | Direct verified connection dot (Pine) | **6.93:1** (AA $\ge 4.5:1$) |

### Dark Palette: "Soft Obsidian & Muted Paper"
| Token | Hex Value | Purpose & Application | Contrast on `--color-bg` |
| :--- | :--- | :--- | :--- |
| `--color-bg` | `#171916` | Main canvas (Soft Obsidian Charcoal) | Base canvas |
| `--color-surface` | `#212421` | Incoming paper bubbles, input background | Elevated dark paper sheet |
| `--color-surface-dim` | `#1E201D` | Home bottom nav bar background, secondary panels | Recessed structural layer |
| `--color-text` | `#EAE6DF` | Body reading text (Muted Paper) | **14.22:1** (AAA $\ge 7:1$) |
| `--color-text-muted` | `#A39E93` | Timestamps, inactive nav labels (Stone) | **6.63:1** (AA $\ge 4.5:1$) |
| `--color-border` | `#333732` | 1px border lines and division rules | Delicate structure |
| `--color-primary` | `#E08560` | Send button, active nav icon (Soft Clay) | **6.48:1** (AA $\ge 4.5:1$) |
| `--color-primary-subtle` | `#2C201A` | Outgoing message bubbles | Soft contextual tint |
| `--color-success` | `#5C9E7B` | Direct verified connection dot (Jade) | **5.59:1** (AA $\ge 4.5:1$) |


*Figures recomputed from the hex values on 2026-08-19; the previous table was
imprecise, and its `--color-primary` row quoted the button pairing rather than
the on-canvas one. Pairings the tables above do not list, but the UI renders:*

| Pairing | Light | Dark |
| :--- | :--- | :--- |
| Button label on `--color-primary` | 6.10:1 | 6.64:1 |
| `--color-text` on `--color-surface` | 15.76:1 | — |
| `--color-text` on `--color-primary-subtle` (outgoing bubble) | 13.46:1 | 12.71:1 |
| `--color-text-muted` on `--color-surface-dim` (nav bar) | 5.11:1 | 6.15:1 |
| `--color-success` on `--color-surface` | 7.46:1 | **4.95:1** |

**The one to watch:** the connection dot on a dark surface is 4.95:1 — clears AA,
not AAA. It is an 8px indicator rather than text, so AA is the applicable bar,
but never render `--color-success` as body copy on `--color-surface` in dark.

---

## 4. Typography Hierarchy (Modular Scale: 1.25x Major Third)

*   **Headline Serif**: `Literata` (`"Literata", "Georgia", serif`) — warm, editorial, unhurried voice.
*   **Body Sans**: `Geist` (`"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`) — clean neutral structure.
*   **Data Mono**: `JetBrains Mono` (`"JetBrains Mono", monospace`) — safe addresses, recovery words, tickets.

---

## 5. Touch Ergonomics & Safe Areas
*   **Touch Targets**: Minimum **$\ge 44\times 44\text{px}$** for all buttons, nav icons, and input controls.
*   **Safe Areas**: Root containers integrate `--safe-top: env(safe-area-inset-top)` and `--safe-bottom: env(safe-area-inset-bottom)` for edge-to-edge rendering on mobile devices.

---

## 6. Where the rest of the system lives

This document covers aesthetic, screen architecture, colour and type. **Spacing,
radii, elevation and motion are defined only in [`tokens.css`](./tokens.css)** —
the single source of truth for every token, imported directly by the app rather
than copied. If a number is needed and it is not here, it is there. Do not
reintroduce a second copy; that drift has already been fixed once.
