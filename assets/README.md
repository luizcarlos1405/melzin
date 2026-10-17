# Brand assets

Melzin's logo and mascot. They're MIT licensed, like the rest of the repository.

## Logo

The mark is a honeycomb cell whose sides are the angle brackets of an HTML tag, with a drop of honey
inside. The wordmark is drawn by hand: monoline and rounded, with the i dotted by a drop of honey.

| File | Use |
|---|---|
| `logo-light.svg` | mark and wordmark, for light backgrounds |
| `logo-dark.svg` | mark and wordmark, for dark backgrounds |
| `icon.svg` | the mark alone; its brackets turn cream when the reader's system uses dark mode |
| `favicon.svg` | the mark for tiny sizes: bolder brackets, no highlight |
| `social-preview.png` | 1280×640 image for link previews (on GitHub: Settings → Social preview) |

## Zin, the mascot

A round bee with honeycomb cells for wings and drops of honey on its antennae. Zin stands for the AI
agents that build views, one cell at a time.

| File | Mood | Good for |
|---|---|---|
| `mascot/zin-hello.svg` | waving | welcomes, headers |
| `mascot/zin-sticker.svg` | waving, with a white sticker outline | any background, dark ones included |
| `mascot/zin-building.svg` | carrying a cell with the logo | docs about building views |
| `mascot/zin-moleza.svg` | wearing sunglasses: *moleza*, "easy" | success |
| `mascot/zin-ops.svg` | surprised: *ops*, "oops" | errors |
| `mascot/zin-soneca.svg` | napping: *soneca*, "nap" | empty and loading states |

Zin's antennae, arms and legs are drawn in bark brown, which fades on dark backgrounds; use the sticker
there.

## Colors

| Name | Hex | Used for |
|---|---|---|
| Honey | `#FBBF24` | the drop, Zin's body |
| Amber | `#F59E0B` | the drop, Zin's body |
| Deep amber | `#D97706` | the bottom of the drop, accents |
| Bark | `#6B3410` | the brackets and wordmark on light backgrounds, Zin's limbs and stripes |
| Cream | `#FFF3D6` | the brackets and wordmark on dark backgrounds |
| Paper | `#FFF8EB` | light backgrounds |
| Night | `#1C1007` | dark backgrounds |

The preview shell keeps its own copies of `favicon.svg`, `zin-ops.svg` and `zin-soneca.svg` in
`packages/melzin/shell/`, so the package works without this folder.
