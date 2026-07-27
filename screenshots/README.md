# Screenshots

`preview.svg` is a vector mock of the shipped interface, used as the README hero
so the repository renders correctly before any binary assets are added.

To capture real screenshots and a demo GIF:

1. Serve the project: `npx serve .`
2. Chrome DevTools > Device Toolbar, then capture at:
   - `iPhone SE` (375 x 667) -> `mobile.png`
   - `iPad Mini` (768 x 1024) -> `tablet.png`
   - Responsive 1440 x 900 -> `desktop.png`
3. Record a short interaction (e.g. `1234 x 9 = ... 10 / 0 =`) with
   ScreenToGif or Chrome's recorder and export `demo.gif` (<= 5 MB, <= 15 s).
4. Drop the files in this folder; the README already links to them.
