---
name: Academic Nexus
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#574239'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f0f1f1'
  outline: '#8b7268'
  outline-variant: '#dfc0b5'
  surface-tint: '#a83900'
  primary: '#a43700'
  on-primary: '#ffffff'
  primary-container: '#cd4800'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb59a'
  secondary: '#a93700'
  on-secondary: '#ffffff'
  secondary-container: '#fd7039'
  on-secondary-container: '#601c00'
  tertiary: '#5b5c5c'
  on-tertiary: '#ffffff'
  tertiary-container: '#747575'
  on-tertiary-container: '#fdfcfc'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcf'
  primary-fixed-dim: '#ffb59a'
  on-primary-fixed: '#380d00'
  on-primary-fixed-variant: '#802a00'
  secondary-fixed: '#ffdbcf'
  secondary-fixed-dim: '#ffb59b'
  on-secondary-fixed: '#380d00'
  on-secondary-fixed-variant: '#812800'
  tertiary-fixed: '#e3e2e2'
  tertiary-fixed-dim: '#c7c6c6'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#464747'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 48px
  gutter: 20px
  margin: 24px
---

## Brand & Style

The design system is engineered for the **Student Support & Mentorship Portal (SSMP)**, targeting an audience of students, faculty mentors, and administrators. The brand personality is **authoritative, efficient, and supportive**. It balances the rigor of academic institutions with the streamlined efficiency of modern enterprise SaaS.

The visual style is **Corporate / Modern** with a focus on data density and clear information architecture. It utilizes a structured grid, high-quality typography, and a refined color system to differentiate user roles and system statuses. The goal is to evoke a sense of reliability and progress, ensuring that complex academic workflows feel manageable and transparent.

## Colors

This design system uses a logic-driven palette to manage complex information hierarchies with increased vibrancy in the primary actions:

- **Primary (Vivid Ochre):** A more energetic and visible orange-red (#f55a0c). It represents active engagement and calls-to-action within the portal. Used for primary buttons, active states, and critical navigation.
- **Secondary (Burnt Sienna):** A slightly more saturated and deep earth tone (#d0501a). Used for faculty-specific workflows and secondary actions that require professional distinction without the urgency of the primary color.
- **Tertiary (Neutral Slate):** A sophisticated grayscale (#aaaaaa) used for administrative utility, subtle dividers, and non-brand specific system functions.
- **Surface & Backgrounds:** Utilizes a pure white base (#ffffff) for the cleanest possible canvas, ensuring maximum contrast for data-heavy views and complex tables.
- **Functional Colors:** Standardized Success, Warning, and Error (Red) are used strictly for system feedback and ticket statuses.

## Typography

The typography system prioritizes legibility and hierarchy to help users scan large amounts of data. 

**Manrope** is used for headlines to provide a modern, technical, yet approachable feel. It’s slightly geometric, which aligns with the tech-forward aesthetic. **Hanken Grotesk** is used for all body text and labels; its clean, sharp letterforms ensure high readability even in dense data tables or long-form feedback messages.

For mobile, headlines scale down significantly to preserve screen real estate for the portal's many multi-step workflows.

## Layout & Spacing

This design system employs a **12-column fluid grid** for desktop and a **single-column layout** for mobile. 

- **Grid Alignment:** Use a 4px baseline grid for vertical rhythm. All component heights and margins should be multiples of 4.
- **Content Containers:** Dashboards utilize a "Masonry-lite" card approach where information blocks (analytics, lists, progress) are contained in cards that span 3, 4, 6, or 12 columns depending on importance.
- **Workflow Spacing:** Use `lg` (32px) spacing between distinct workflow steps and `sm` (16px) for internal card elements.
- **Mobile Reflow:** Margins reduce to 16px. Cards stack vertically, and horizontal scrolling is permitted only for wide data visualizations or tables.

## Elevation & Depth

To maintain a clean and professional look, this design system avoids heavy shadows. Instead, it uses **Tonal Layers** and **Low-Contrast Outlines**:

- **Level 0 (Background):** Pure Neutral white (#ffffff).
- **Level 1 (Cards/Containers):** Elevated surface with a 1px border (#aaaaaa).
- **Level 2 (Hover/Active):** A very soft, diffused shadow (0px 4px 12px rgba(0,0,0,0.05)) is applied only when a card or button is interactive or being "picked up" in a drag-and-drop workflow.
- **In-Set Depth:** Progress tracks and input fields use a subtle inner stroke to appear slightly recessed, emphasizing their "utility" nature.

## Shapes

The design system uses **Soft (Level 1)** roundedness. 

- **Components:** Buttons, inputs, and small cards use a 4px (`rounded`) corner radius. This conveys precision and professionalism without being too sharp or aggressively playful.
- **Containers:** Larger dashboard cards and modal overlays use 8px (`rounded-lg`) to soften the overall interface density.
- **Circular Elements:** Progress rings, status dots, and user avatars remain fully circular to contrast against the rectangular grid.

## Components

### Buttons & Interaction
- **Primary:** Solid Vivid Ochre with white text.
- **Secondary/Role-Based:** Ghost buttons with colored borders matching the user's role (Burnt Sienna for Faculty, Neutral Slate for Admin).
- **Action Icons:** 20px icons centered within a 40px square container for high tap-target accuracy.

### Workflow & Status
- **Progress Indicators:** A horizontal stepped track with "active," "completed," and "pending" states. Active states use the role-based color; completed states use a checkmark icon.
- **Status Badges:** Small, high-contrast pills (e.g., "Open," "In-Progress," "Resolved") using light tinted backgrounds with dark text of the same hue.
- **Data Visualizations:** Use a "Safe Palette" for charts (Ochre, Sienna, Slate) to ensure accessibility. Avoid using Red/Green except for literal Success/Failure metrics.

### Input & Cards
- **Input Fields:** Labeled on top, 1px border, 12px horizontal padding. Focus state uses a 2px primary ochre outline.
- **Information Cards:** Header section with a subtle 1px bottom divider, followed by content. Footers are reserved for contextual actions (e.g., "View Ticket," "Approve").