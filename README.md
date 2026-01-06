# Encrypted Markdown Reader

A client-side markdown reader that decrypts encrypted markdown files directly in the browser. Designed for GitHub Pages deployment with **no server-side dependencies**.

## Features
- AES-256-GCM encryption with PBKDF2 key derivation
- GitHub `docs/` browser with folder grouping and search
- Passphrase strength meter and multi-passphrase support per file
- Optional GitHub token support for private repos and uploads
- Client-side only analytics counters (no network tracking)
- Lazy-loaded markdown rendering with sanitization and syntax highlighting
- Export decrypted content to text or PDF and bundle encrypted payloads
- Offline support via Service Worker
- Keyboard shortcuts for common actions (`f`, `p`, `t`, `c`, `l`, `m`)

## Setup Guide
1. Clone the repository.
2. Serve the repo with any static server (or deploy to GitHub Pages).
3. Open `index.html` in your browser.
4. Enter the sample passphrase: `radiopass`.
5. Select a sample file and click **Load Sample**.

### GitHub Pages
This repo is ready to deploy on GitHub Pages. The included `CNAME` file supports a custom domain. Update `CNAME`, the Open Graph metadata in `index.html`, and the sitemap/robots URLs to match your domain before deployment.

### Scripts
- `npm test` runs the encryption/decryption test suite.

## Security Disclaimer
This app runs entirely in the browser. Client-side encryption protects content in transit and at rest **only** if your passphrase remains secure. Anyone with access to the decrypted content in the browser session can read it. Always:
- Use strong, unique passphrases
- Close the tab when finished
- Avoid using shared machines for sensitive content

## How To Encrypt/Decrypt Files
### Encryption
1. Use AES-256-GCM with a 12-byte IV.
2. Derive the key with PBKDF2 (SHA-256, 100,000 iterations, 32-byte key).
3. Store the payload in JSON:

```json
{
  "version": 1,
  "salt": "base64",
  "iv": "base64",
  "ciphertext": "base64"
}
```

### Decryption
- Provide the same passphrase used to encrypt the file.
- The app validates the version and decrypts the payload in memory.

## Premium Features
- **Multiple passphrases:** stored in memory per file during the session.
- **Search:** filters file list using cached decrypted content.
- **Category filtering:** group and filter docs/ subfolders.
- **Export:** download decrypted content as text or print to PDF.
- **Encrypted bundles:** import/export encrypted JSON bundles for offline sharing.
- **Version history:** timestamps of recently viewed files.
- **Encrypt & upload:** create encrypted files and push to GitHub with a token.

## FAQ
**Does this upload my files?**
No. Files are decrypted locally in the browser. GitHub content is fetched directly from GitHub when requested.

**Can I store decrypted files in LocalStorage?**
No. The app avoids persistent storage for decrypted content by design.

**What happens if I close the tab?**
Decrypted content is cleared. A warning appears if you try to leave with decrypted content active.

## Example Use Cases
- Sharing encrypted project notes on GitHub Pages
- Keeping release runbooks encrypted while still accessible in emergencies
- Hosting confidential documentation with client-side decryption

## Limitations
- Client-side encryption cannot protect against compromised devices or browsers.
- PDF export uses the browser print dialog and may vary by browser.
- Large files rely on lazy rendering, but very large payloads may still impact memory.

## Development
See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow details. The code of conduct is in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License
MIT (see [LICENSE](LICENSE)).
