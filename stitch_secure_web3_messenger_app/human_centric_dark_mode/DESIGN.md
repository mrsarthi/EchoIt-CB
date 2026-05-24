---
name: Human-Centric Dark Mode
colors:
  surface: '#121316'
  surface-dim: '#121316'
  surface-bright: '#38393c'
  surface-container-lowest: '#0d0e11'
  surface-container-low: '#1b1b1f'
  surface-container: '#1f1f23'
  surface-container-high: '#292a2d'
  surface-container-highest: '#343538'
  on-surface: '#e3e2e6'
  on-surface-variant: '#c6c5d2'
  inverse-surface: '#e3e2e6'
  inverse-on-surface: '#303034'
  outline: '#8f909b'
  outline-variant: '#454650'
  surface-tint: '#b8c4ff'
  primary: '#c9d1ff'
  on-primary: '#1a2b6a'
  primary-container: '#a5b4fc'
  on-primary-container: '#354484'
  inverse-primary: '#4b5a9c'
  secondary: '#62dcad'
  on-secondary: '#003827'
  secondary-container: '#18a479'
  on-secondary-container: '#003121'
  tertiary: '#d1d3d5'
  on-tertiary: '#2d3133'
  tertiary-container: '#b5b8ba'
  on-tertiary-container: '#45494b'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dde1ff'
  primary-fixed-dim: '#b8c4ff'
  on-primary-fixed: '#001354'
  on-primary-fixed-variant: '#334282'
  secondary-fixed: '#80f9c8'
  secondary-fixed-dim: '#62dcad'
  on-secondary-fixed: '#002115'
  on-secondary-fixed-variant: '#00513a'
  tertiary-fixed: '#e0e3e5'
  tertiary-fixed-dim: '#c4c7c9'
  on-tertiary-fixed: '#191c1e'
  on-tertiary-fixed-variant: '#444749'
  background: '#121316'
  on-background: '#e3e2e6'
  surface-variant: '#343538'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-padding-mobile: 1.25rem
  container-padding-desktop: 2.5rem
  gutter: 1.5rem
  stack-sm: 0.5rem
  stack-md: 1rem
  stack-lg: 2rem
---

## Brand & Style

This design system is built on the principle of "Digital Empathy." It moves away from the cold, sterile nature of traditional dark modes, opting instead for a warm, approachable environment that feels safe and intuitive. The aesthetic is a blend of **Warm Minimalism** and **Soft Corporate**, prioritizing clarity and emotional comfort.

The target audience seeks a stress-free experience, valuing simplicity over technical density. By using soft charcoal backgrounds instead of pure black, we reduce eye strain and create a sense of depth that feels organic rather than mechanical. The emotional response should be one of quiet confidence—users should feel "at home" and protected within the interface.

## Colors

The palette is anchored by a deep, soft charcoal-black (`#0e0f12`) which serves as the canvas. Unlike high-contrast black themes, this softer base allows for a more "paper-like" feel in a digital space.

- **Primary (Pastel Indigo):** Used for main actions, active states, and brand moments. It provides a reassuring, stable focal point.
- **Secondary (Calm Mint):** Utilized for success states, confirmations, and "safe" actions. It acts as a gentle nudge of encouragement.
- **Neutral/Surface:** We use subtle variations of the charcoal base to define containers, ensuring that the UI feels layered rather than flat.
- **Semantic Colors:** Warning and Error states should be muted (desaturated reds/oranges) to avoid alarming the user unnecessarily, maintaining the "calm" atmosphere.

## Typography

The typography strategy balances the precision of **Geist** for structural elements and headers with the universal readability of **Inter** for body text. 

To maintain the human-centric personality, we avoid all-caps for long strings of text and keep line heights generous (1.6 for body) to ensure a relaxed reading pace. Headlines use a slightly tighter letter-spacing and heavier weight to provide a clear hierarchy without appearing aggressive. Labels and micro-copy are kept friendly and conversational, utilizing "Human" terminology—e.g., "Where you're at" instead of "Current Location."

## Layout & Spacing

The layout follows a **Fixed Grid** model on desktop (12 columns, 1200px max-width) and a fluid 4-column model on mobile. We prioritize "breathable" layouts, meaning white space is used as a functional tool to separate ideas rather than using heavy lines.

- **Rhythm:** A 8px baseline grid ensures vertical consistency.
- **Margins:** Large outer margins (40px on desktop) help the content feel centered and important, like a framed piece of art.
- **Reflow:** On mobile transitions, elements should stack vertically with a minimum of 16px (`stack-md`) between cards to maintain a clear sense of separation.

## Elevation & Depth

In this dark-mode environment, depth is communicated through **Tonal Layering** and **Soft Ambient Shadows**. We avoid high-contrast white borders.

- **Level 0 (Background):** The base charcoal (`#0e0f12`).
- **Level 1 (Cards/Containers):** A slightly lighter tint of charcoal (approx. 5% lighter) with a subtle 1px border of the same color to define the edge.
- **Level 2 (Overlays/Modals):** These use a soft, diffused shadow (0px 10px 30px rgba(0,0,0,0.4)) and a very subtle backdrop blur (8px) to suggest they are floating above the main interface.

The goal is to create a "tactile" feel where the user understands what is interactive based on its perceived physical height.

## Shapes

The shape language is defined by **Soft 16px Rounded Corners**. This specific radius (1rem) is applied to all primary containers and cards, creating a friendly, "squircle-like" appearance that avoids the harshness of sharp edges.

- **Buttons & Small Elements:** Use a 12px radius to maintain visual harmony with larger cards.
- **Form Inputs:** Mirror the button radius for consistency.
- **Icons:** Should feature rounded terminals and soft corners to match the UI housing. 

Avoid 0px corners entirely; even "divider" lines should have rounded caps to maintain the approachable brand personality.

## Components

### Buttons
Primary buttons use the Pastel Indigo background with dark text for maximum legibility. Secondary buttons are outlined with a 2px stroke. All buttons feature a 16px vertical padding to ensure they are "touch-friendly" and inviting.

### Cards
Cards are the primary organizational unit. They should have a subtle 1px border (`#1e1f24`) and 24px of internal padding. Content inside should be grouped logically using the defined spacing stack.

### Form Fields
Inputs use a slightly darker-than-card background to create an "inset" feel. The focus state uses a 2px Calm Mint border, signaling safety and readiness. Use placeholder text that sounds helpful, like "Tell us your name" instead of "Input Name."

### Chips & Tags
Used for categorization, chips should be pill-shaped and use low-opacity versions of the accent colors (e.g., 10% Indigo) to remain subtle and non-distracting.

### Human-Centric Labels
Standard technical labels are replaced:
- "Authentication" → "Sign In"
- "Wallet_Address_01" → "My Wallet"
- "Submit Request" → "Send"
- "Error 404" → "We can't find that page"