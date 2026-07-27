# Manual QA Checklist

Automated coverage lives in `engine.test.js` (24 cases, pure logic).
This checklist covers what only a browser can verify. Run it in Chrome,
Firefox and Edge before tagging a release.

## Rendering

- [ ] LED ghost segments (`888888888888`) visible behind the readout
- [ ] Scanlines and the slow CRT sweep animate without flicker
- [ ] Digits animate in on every change
- [ ] Caret blinks while typing an operand, disappears after `=` or an operator
- [ ] Error state turns the readout red and shakes once
- [ ] Long results shrink the font instead of overflowing the panel

## Interaction

- [ ] Every key responds to mouse, touch and stylus
- [ ] Press animation fires on pointer down and on the matching keyboard key
- [ ] `CE` is disabled when the entry is already `0` and nothing is pending
- [ ] No double-firing when a key is held down

## Keyboard

- [ ] `0`-`9`, `.`, `,`, `+`, `-`, `*`, `x`, `/`, `%`
- [ ] `Enter` / `=` evaluates; `Enter` on a focused button presses that button
- [ ] `Backspace` deletes, `Delete` clears the entry, `Esc` clears everything
- [ ] `/` does not open Firefox quick-find; `Enter` does not scroll

## Accessibility

- [ ] `Tab` reaches the skip link, then every key in visual order
- [ ] Focus ring is clearly visible on every key type
- [ ] Screen reader announces each new result exactly once (live region)
- [ ] Operator keys announce their names, not their glyphs
- [ ] Zoom to 200% keeps the layout usable
- [ ] Windows High Contrast mode keeps all keys legible
- [ ] `prefers-reduced-motion` disables the CRT sweep and digit animation

## Responsiveness

- [ ] 320px phone: no horizontal scroll, keys at least 44px tall
- [ ] 768px tablet: shell grows, spacing widens
- [ ] Desktop: shell caps at 440px and stays centred
- [ ] Landscape phone (<=560px tall): keypad fits without scrolling

## Health

- [ ] No console errors or warnings on load and after 50 random keypresses
- [ ] Lighthouse (Performance / Accessibility / Best Practices / SEO) > 95
- [ ] W3C HTML validator: no errors
- [ ] W3C CSS validator: no errors
