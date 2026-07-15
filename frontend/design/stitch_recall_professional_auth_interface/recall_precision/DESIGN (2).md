---
name: Recall Precision
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#c0c1ff'
  on-secondary: '#1000a9'
  secondary-container: '#3131c0'
  on-secondary-container: '#b0b2ff'
  tertiary: '#ffffff'
  on-tertiary: '#2f3131'
  tertiary-container: '#e2e2e2'
  on-tertiary-container: '#636565'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 56px
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  title-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.011em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.006em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1280px
  gutter: 24px
  margin-x: 32px
  stack-xs: 4px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
  stack-xl: 48px
---

## Brand & Style

The design system is engineered for high-performance AI environments where precision and trust are paramount. It adopts a **Professional / Modern** aesthetic, heavily influenced by the "technical premium" movement. The interface prioritizes clarity, speed, and structural integrity, evoking the feeling of a high-end physical tool or a professional flight deck.

The visual narrative is built on three pillars:
- **Atmospheric Depth:** Layers are defined by tonal shifts and micro-borders rather than heavy drop shadows.
- **Precision Typography:** A systematic approach to type that favors utility and information density.
- **Functional Polish:** Every interaction and state change is subtle, purposeful, and refined, avoiding unnecessary ornamentation.

## Colors

The palette is anchored in a deep charcoal and slate spectrum to minimize eye fatigue and maximize focus. 

- **Base:** The primary background is a true neutral black (`#0A0A0A`).
- **Surface Layers:** Elevate secondary containers using a deep charcoal (`#171717`) and interactive elements with a lighter slate (`#262626`).
- **Accent:** The primary action color is a crisp White (`#FFFFFF`), providing maximum contrast against the dark base. A vibrant Indigo (`#6366F1`) is used sparingly for data visualization, success states, or subtle brand highlights.
- **Borders:** Instead of solid lines, use low-opacity white strokes (`rgba(255, 255, 255, 0.08)`) to create definition that feels "etched" into the screen.

## Typography

This design system utilizes **Inter** exclusively to maintain a systematic, utilitarian appearance. The hierarchy is defined by tight tracking (letter-spacing) on larger headlines to create a compact, modern feel, and slightly increased tracking on small labels to ensure legibility.

- **Weight usage:** Bold weights are reserved for high-level headings. Medium weights are used for interactive labels to provide "heft" without clutter.
- **Contrast:** Always use pure white (`#FFFFFF`) for primary text and a secondary gray (`#A3A3A3`) for supporting text. 
- **Scale:** Maintain a strict rhythmic scale to ensure consistency across data-heavy dashboards.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop to maintain a professional, "dashboard-like" density, transitioning to a fluid model for mobile.

- **Grid:** A 12-column grid with 24px gutters.
- **Scaling:** On desktop, content is centered within a 1280px container. On mobile, margins reduce to 16px to maximize screen real estate.
- **Rhythm:** An 8px linear scale governs all padding and margin decisions. Use `stack-md` (16px) for standard grouping and `stack-lg` (24px) for section separation.

## Elevation & Depth

This design system avoids traditional drop shadows in favor of **Tonal Layering** and **Micro-borders**. 

- **Surface Tiers:**
    - Level 0: `#0A0A0A` (Background)
    - Level 1: `#171717` (Cards, Sidebars)
    - Level 2: `#262626` (Popovers, Modals)
- **Highlights:** Use a subtle radial gradient at the top-center of primary containers (white, 3% opacity) to simulate a soft overhead light source.
- **Borders:** Every elevated element must have a 1px border. Use `rgba(255, 255, 255, 0.1)` for top borders and `rgba(255, 255, 255, 0.05)` for side/bottom borders to create a simulated 3D "bevel" effect.

## Shapes

The shape language is precise and disciplined. A **Soft (0.25rem)** base radius is used for small components like inputs and buttons to maintain a professional edge. 

- **Standard Radius:** 6px (buttons, inputs).
- **Container Radius:** 8px to 12px (cards, modals).
- **Contextual Shapes:** Icons and decorative elements should maintain sharp corners or very minimal rounding to align with the technical aesthetic.

## Components

### Buttons
Buttons should feel substantial. The **Primary Button** uses a solid white background with black text and a subtle inner shadow (top-down) to look slightly recessed. **Secondary Buttons** use a dark slate background with a micro-border that brightens on hover.

### Input Fields
Inputs are grounded in Level 1 surfaces (`#171717`). On focus, the border opacity should increase to 25%, and a subtle 2px outer glow (Indigo, 10% opacity) should appear. Use a monospaced font for data-heavy inputs to reinforce the precision theme.

### Cards
Cards utilize the Level 1 surface. They should not have shadows; instead, use the "etched" border technique. On hover, the background can subtly shift to Level 2.

### Chips & Badges
Small, high-contrast elements. Use a dark background with a border matching the label color (e.g., a green border for "Success") at 20% opacity.

### Navigation
Vertical navigation is preferred for SaaS density. Active states are indicated by a subtle vertical line on the left and a 5% white background tint on the menu item.