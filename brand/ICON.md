# AgentPass — Brand & Icon

The mark is a **keyhole plate**: a warm near-black rounded square holding a
terracotta keyhole. Credential + access, in the Claude warm design language.

## Files
| File | Use |
|------|-----|
| `logo-primary.svg` | Default. Black plate + terracotta keyhole. Light backgrounds. |
| `logo-brand.svg` | Terracotta plate + ivory keyhole. Brand moments / hero. |
| `logo-dark.svg` | Sand plate + terracotta keyhole. Dark (near-black) sections. |
| `logo-mono.svg` | Single colour via `currentColor`. Set `color:` on the parent. Small sizes, print, one-colour contexts. |
| `app-icon.svg` | 1024² full-bleed squircle. Source for OS app icons. |
| `lockup-horizontal.svg` | Mark + `AgentPass` wordmark, side by side. |

The landing page inlines the mark as an SVG symbol rather than linking a file —
2.0 has no application window to put an icon in.

## Palette
| Token | Hex | Role |
|-------|-----|------|
| Near Black | `#141413` | Plate, primary text |
| Terracotta | `#c96442` | Keyhole, primary accent / CTA |
| Coral | `#d97757` | Lighter accent, links on dark |
| Ivory | `#faf9f5` | Keyhole on brand/app icon, card surface |
| Sand | `#e8e6dc` | Plate on dark variant |
| Parchment | `#f5f4ed` | Page background |

## Typography
- Wordmark / headings: **Anthropic Serif** (fallback **Newsreader** / Georgia), weight 500.
- UI / labels: **Anthropic Sans** (fallback Inter / system-ui).

## Rules
- **Clear space** ≥ half the plate height on every side.
- **Min size**: mark 16px; below 24px prefer `logo-mono` or the favicon (solid dot keyhole).
- Keep the keyhole centred and upright; don't recolour it outside the palette.
- Don't add drop shadows, gradients, or outlines to the filled variants.
- Don't stretch — scale uniformly. Don't put `logo-primary` on a dark background (use `logo-dark`).

`app-icon.png` is a 1024² raster of `app-icon.svg` (regenerate from the SVG if
the mark changes). It is kept for anything that needs a square app icon; the
1.x desktop build that consumed it is in the [v1.0.3
release](https://github.com/sooua/AgentPass/releases/tag/v1.0.3).
