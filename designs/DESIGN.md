---
name: DocPilot
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#43474e'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#455f87'
  primary: '#022448'
  on-primary: '#ffffff'
  primary-container: '#1e3a5f'
  on-primary-container: '#8aa4cf'
  inverse-primary: '#adc8f5'
  secondary: '#855300'
  on-secondary: '#ffffff'
  secondary-container: '#fea619'
  on-secondary-container: '#684000'
  tertiary: '#1c2337'
  on-tertiary: '#ffffff'
  tertiary-container: '#31394e'
  on-tertiary-container: '#9ba3bb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#adc8f5'
  on-primary-fixed: '#001c3b'
  on-primary-fixed-variant: '#2d486d'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  sidebar-width: 240px
  container-padding: 2rem
  gutter: 1.5rem
  stack-sm: 0.5rem
  stack-md: 1rem
  stack-lg: 1.5rem
---

## Brand & Style

This design system is built for the high-stakes, precision-oriented environment of telecom infrastructure. The brand personality is **authoritative, industrial, and hyper-efficient**, mirroring the reliability required for fiber optic deployment. It balances a sturdy, corporate foundation with modern interface techniques to ensure clarity for field crews operating in various environments.

The visual style is **Industrial Modern**. It utilizes a sophisticated "Corporate" base—characterized by structured layouts and a deep navy palette—and enhances it with **Glassmorphism** for temporary overlays. This creates a clear mental model: the underlying "ground truth" data remains visible while active tasks or modals float above it with high-clarity blurs, reducing cognitive load for users managing complex field data.

## Colors

The color palette of this design system is anchored in **Navy (#1E3A5F)** to project stability and trust. An **Amber Accent (#F59E0B)** is used sparingly to draw attention to primary actions and critical alerts, providing high visibility against the cool-toned background.

The background uses a crisp **Slate (#F8FAFC)** to reduce screen glare, while the sidebar utilizes a deep **Charcoal (#0F172A)** to establish a clear architectural boundary. Status colors are mapped to industry standards to ensure immediate recognition:
- **Success/Active:** Emerald Green
- **Warning/On-Hold:** Amber
- **Information/Waiting:** Blue
- **Error:** Red
- **Neutral/Pending:** Slate Grey

## Typography

The design system exclusively employs **Inter** for its systematic, utilitarian legibility. To maintain an authoritative hierarchy, all headings are set in **Bold (700)** or **Semi-Bold (600)** weights. 

For field data entry and technical readings, numerical clarity is paramount; Inter’s tall x-height and distinct character shapes prevent misinterpretation of cable IDs or measurements. Label styles utilize uppercase styling with increased letter-spacing for structural elements like table headers and sidebar categories.

## Layout & Spacing

This design system utilizes a **Fixed-Fluid Hybrid** model. Navigation is anchored by a persistent **240px dark sidebar**, while the main content area expands fluidly to maximize the visibility of GIS maps and data tables. 

A strict **8px base spacing scale** ensures vertical rhythm. On desktop, the main content uses 32px (2rem) margins. For mobile and tablet views, the sidebar collapses into a hamburger menu or bottom bar, and horizontal margins reduce to 16px to prioritize screen real estate for field inputs.

## Elevation & Depth

Visual hierarchy is managed through three distinct layers:
1.  **The Base Layer:** The Light Slate (#F8FAFC) background acts as the canvas.
2.  **The Surface Layer:** Cards and containers use a White (#FFFFFF) surface with a **subtle shadow** (0px 2px 4px rgba(15, 23, 42, 0.05)) to appear slightly raised.
3.  **The Interaction Layer:** Modals, dropdowns, and overlays utilize **Glassmorphism**. These elements feature a semi-transparent white fill (opacity 80%) with a **16px backdrop-blur**. This allows the user to maintain environmental context of the data beneath the modal while focusing on the immediate task.

## Shapes

The shape language of this design system is **Softly Geometric**, favoring approachability without sacrificing professional structure. 

While the system generally follows a **0.5rem (8px)** base roundedness for interactive elements like buttons and inputs, **Cards** utilize a larger **12px radius** to distinguish them as structural containers. This variance helps the user subconsciously differentiate between "objects to click" and "areas to read." Status badges utilize a fully rounded (pill) shape to differentiate them from interactive buttons.

## Components

### Buttons
Primary buttons use the 8px radius, a Navy (#1E3A5F) background, and white text. The Amber (#F59E0B) accent is reserved for "Call to Action" buttons (e.g., "Submit Log"). Secondary buttons use a transparent background with a 1px Slate border.

### Cards
Cards are the primary layout unit. They feature a 12px radius, white background, and a subtle 1px border (#E2E8F0) to ensure definition against the slate background.

### Input Fields
Inputs are styled for high-speed data entry: white background, 8px radius, and a 1px border. On focus, the border transitions to a **2px Navy stroke**, providing a clear "active" state for field crews using mobile devices.

### Status Badges
Badges use a "soft-fill" approach: a light tint of the status color for the background with high-contrast dark text in the same hue.
- **Done/Active:** Light green bg, dark green text.
- **Waiting:** Light blue bg, dark blue text.
- **On Hold:** Light amber bg, dark amber text.

### Modals
Modals must use the glassmorphic style (16px blur) and be centered on the screen with a 24px inner padding. They should always include a clear Navy header and an Amber primary action button.