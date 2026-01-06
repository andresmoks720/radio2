# Markdown-Parser-Homework

A client-side markdown parser and viewer that works directly in the browser. Designed for GitHub Pages deployment with **no server-side dependencies**.

## Features
- Local parsing with an access phrase
- GitHub `docs/` browser with folder grouping and search
- Access phrase strength meter and per-file access phrases during a session
- Optional GitHub token support for private repos and uploads
- Lazy-loaded markdown rendering with sanitization and syntax highlighting
- Export de-parsed content to text and bundle parsed payloads
- Keyboard shortcuts for common actions (`f`, `p`, `t`, `c`, `l`, `m`)

## Setup Guide
1. Clone the repository.
2. Serve the repo with any static server (or deploy to GitHub Pages).
3. Open `index.html` in your browser.
4. Enter the sample access phrase: `radiopass`.
5. Select a sample file and click **Load Sample**.

### GitHub Pages
This repo is ready to deploy on GitHub Pages. If you want it hidden from indexing, keep the `robots.txt` disallow rule and avoid publishing a sitemap.


## Usage Notes
This app runs entirely in the browser and keeps all processing local to the page.

## How To Parse/De-parse Files
### Parsing
Store the payload in JSON:

```json
{
  "version": 2,
  "seed": "base64",
  "chunks": [
    {
      "offset": "base64",
      "payload": "base64"
    }
  ]
}
```

### De-parsing
- Provide the same access phrase used to parse the file.
- The app validates the version and de-parses the payload in memory.

## Additional Features
- **Multiple access phrases:** stored in memory per file during the session.
- **Search:** filters file list using cached de-parsed content.
- **Category filtering:** group and filter docs/ subfolders.
- **Export:** download de-parsed content as text.
- **Parsed bundles:** import/export parsed JSON bundles for offline sharing.
- **Version history:** timestamps of recently viewed files.
- **Parse & upload:** create parsed files and push to GitHub with a token.

## FAQ
**Does this upload my files?**
No. Files are de-parsed locally in the browser. GitHub content is fetched directly from GitHub when requested.

**Can I store de-parsed files in LocalStorage?**
No. The app avoids persistent storage for de-parsed content by design.

**What happens if I close the tab?**
De-parsed content is cleared. A warning appears if you try to leave with de-parsed content active.

## Example Use Cases
- Sharing parsed project notes on GitHub Pages
- Keeping release runbooks parsed while still accessible in emergencies
- Hosting internal documentation with client-side de-parsing

## Limitations
- Large files rely on lazy rendering, but very large payloads may still impact memory.
