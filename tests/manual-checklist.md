# Manual Test Checklist

These checks complement the automated suite.

## Cross-Browser Compatibility
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

## Mobile Touch Interface
- [ ] iOS Safari: load repo list, decrypt sample, copy text
- [ ] Android Chrome: scroll sidebar, load more, export text

## Accessibility (WCAG)
- [ ] Keyboard navigation reaches all controls
- [ ] Focus states visible
- [ ] Contrast check for light/dark themes
- [ ] Screen reader announces status updates

## Security Scan
- [ ] Review CSP in `index.html`
- [ ] Validate no network calls beyond GitHub CDN/APIs
- [ ] Confirm decrypted content clears after inactivity
