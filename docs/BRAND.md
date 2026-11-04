# Spectrum Group design tokens

Extracted on 4 Nov 2026 from the live `:root` custom properties and computed styles of
**spectrumgroup.id**. `hr.spectrumgroup.id` sits behind Cloudflare Access (Google sign-in),
so it could not be inspected automatically; these tokens come from the public site, which the HR
app is expected to share. Re-check against HR once someone signs in.

All tokens live in `src/app/globals.css` (as RGB triplets so Tailwind's `/opacity` works)
and are mapped in `tailwind.config.ts`.

## Surfaces & text

| Token | Value | Tailwind | Use |
|---|---|---|---|
| `--bg` | `#202020` | `bg-sg-bg` / `bg-background` | page background |
| `--card` | `#262626` | `bg-sg-card` | cards, panes |
| `--card-2` | `#2b2b2b` | `bg-sg-card-2` | hover, menus |
| `--card-3` | `#333333` | `bg-sg-card-3` | selected / chips (CRM addition, one step up) |
| `--text` | `#f2f2f2` | `text-sg-text` | body text |
| `--muted` | `#b4b4b4` | `text-sg-muted` | secondary text, nav links |
| `--dim` | `#7a7a7a` | `text-sg-dim` | tertiary text, eyebrows |
| `--white` | `#ffffff` | `text-sg-white` / `bg-primary` | headings, primary CTA |
| `--line` | `rgba(255,255,255,.10)` | `border-sg-line` | default borders |
| `--line-2` | `rgba(255,255,255,.22)` | `border-sg-line-2` | hover / emphasis borders |

## The spectrum

Saturated colours appear in the logo bars; the softer set is used for data and status.

| Name | Saturated | Soft |
|---|---|---|
| magenta | `#D926D8` | `#C05EBF` |
| blue | `#2626D9` | `#8384E2` |
| cyan | `#26D8D9` | `#5EBFC0` |
| green | `#26D92A` | `#5EC060` |
| yellow | `#D8D926` | `#BFC05E` |
| orange | `#D97D26` | `#C08D5E` |
| red | `#D92626` | `#C05E5E` |

`bg-spectrum-*` for marks and dots, `text-soft-*` / `bg-soft-*/15` for chips, statuses and charts.
`.sg-spectrum-rule` draws the seven-colour rule used at the top of dialogs and drawers.

## Type

- Family: `'Gotham', 'Montserrat', system-ui, sans-serif` — Montserrat 400–800 loaded via `next/font`.
- Headings: Montserrat **800** (h1/h2), **700** (h3), **600** (h4), letter-spacing −0.015em.
- Site body is 16–17px; the CRM uses a denser 12.5–13.5px scale for data views.
- Eyebrows: 10.5px, 600, uppercase, 0.14em tracking, `--dim`.

## Shape & motion

- Primary CTA: solid white, `#202020` text, **3px** radius, 600 weight, 0.04em tracking (`<Button variant="primary">`).
- Secondary CTA: white outline **pill** (100px radius) (`variant="pill"`).
- Cards: `--card` with 1px `--line` border and **12px** radius, no shadow.
- Easing: `cubic-bezier(.2,.7,.2,1)` → `ease-sg`.
