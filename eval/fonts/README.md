# Bundled fonts

The eval sample generator ([`eval/render.ts`](../render.ts)) embeds these fonts
to render the Hebrew sample invoice — the standard PDF fonts (WinAnsi-encoded)
can't render Hebrew, so a Unicode TTF must be embedded via `@pdf-lib/fontkit`.

## Noto Sans Hebrew

- `NotoSansHebrew-Regular.ttf`, `NotoSansHebrew-Bold.ttf`
- © The Noto Project Authors — licensed under the **SIL Open Font License 1.1**
  (full text in [`OFL.txt`](./OFL.txt)).
- Source: <https://github.com/googlefonts/noto-fonts>

Only the Hebrew subset is used (and `embedFont(..., { subset: true })` further
shrinks what's embedded in each PDF). These are build-time assets for the eval
corpus; they are not served to the browser.
