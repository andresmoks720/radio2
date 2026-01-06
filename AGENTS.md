# agents.md

Guidance for AI agents (and humans) working in this repo.

## Prime directive
Reduce how long plaintext exists, how much exists at once, and where it can leak to.

Assume: if plaintext exists in RAM as a big JS string, it’s effectively “there for anyone who can read process memory.”

## Vocabulary restriction
This file is the only location in the repo that may include sensitive vocabulary. All other files must avoid conspicuous terms in UI text, comments, identifiers, and string literals. Prohibited terms elsewhere include: “encrypted”, “encrypt”, “decrypt”, “decrypted”, “encryption”, “secret”, “secure”, “confidential”, “cipher”, “private”, “sensitive”, and similar words.

---

## Primary intent
Build a **static, client-side document reader** where encrypted content can be accessed without a server, while keeping the project **low-profile**:
- Neutral appearance and wording (doesn’t advertise “secret stuff”).
- Minimal data persistence on the host.
- Minimal plaintext exposure during normal use.
- Keep **copy/paste** available (explicit, user-initiated).

## Non-goals
- “Perfect” protection on a compromised host. If the OS/browser is hostile, anything shown to a user can be captured.
- Adding analytics/telemetry, fingerprinting, crash reporting, or remote logging.

---

## Core rules (must keep)

### 1) Encrypted-only content
- Repo/browser listing must **only** accept encrypted payloads (e.g. `.md.enc`, `.md.data`, or the canonical extension used here).
- Reject plaintext markdown at load time (and ideally at listing time).
- No fallback code paths that fetch `.md` and `response.text()` it.

### 2) Minimize plaintext residency
- Avoid holding “full document plaintext” as one big string in JS memory.
- Prefer chunked/streamed decrypt → render/use → scrub.
- Don’t cache decrypted content for search/history. If search exists, it must work without retaining full plaintext (or it must be explicitly opt-in with clear risk).

### 3) No persistent storage of decrypted content
- No LocalStorage/IndexedDB/sessionStorage storing plaintext.
- Service worker caches **only** static app assets and **encrypted** payloads (never decrypted output, never rendered HTML output).

### 4) Low-profile UI/UX
- Use neutral names and labels (e.g., “Reader”, “Notes”, “Open file”) rather than “Encrypted”, “Confidential”, “Secure”, “Secret”.
- Avoid watermarks like “CONFIDENTIAL” and avoid conspicuous iconography that signals sensitivity.
- Errors/status should be generic and short.

### 5) Low-noise runtime behavior
- No verbose `console.log` in production builds.
- Keep network requests predictable and minimal:
  - Only fetch what the user explicitly requests (listing + selected files).
  - Use `cache: "no-store"` for sensitive fetches where supported.

### 6) Safety with tokens/credentials
- GitHub token stays in memory only; never persist it.
- Never echo tokens into the DOM, URL, logs, errors, or BroadcastChannel messages.

---

## Secure coding practices to implement (while keeping copy/paste)

## A) Minimize plaintext lifetime (short-lived + partial)

### A1) Chunked decrypt → render/use → discard
**Rule:** Never materialize the whole document plaintext.
- Decrypt one chunk at a time.
- Convert bytes → string only for the minimal window needed to render or process.
- Immediately drop references and overwrite typed arrays.

Implementation expectations:
- Payload format supports chunking.
- Renderer appends chunk output incrementally.
- “Load more” decrypts the next chunk; previous chunks are not retained as plaintext.

### A2) Copy/export must be on-demand re-decrypt (keep copy/paste)
**Rule:** No `currentMarkdown` full plaintext stored.
- For copy/export: re-decrypt the required chunks on demand, stream to the destination, then discard immediately.
- Copy/paste remains supported, but must be **explicit** and **user-initiated**.

Practical note:
- Clipboard and downloaded files are plaintext outside the app. Keep this path obvious and initiated by the user (no auto-copy/auto-export).

### A3) Aggressive zeroization where feasible
**Rule:** Overwrite buffers that can be overwritten.
- Use `Uint8Array` for decrypted bytes; `fill(0)` immediately after use.
- Overwrite passphrase-derived material when possible.
- Avoid long-lived references that keep buffers alive via closures.

Reality check:
- JS strings are immutable and not reliably wipeable; minimize their creation and lifetime.

### A4) Use overwrite-friendly data types
**Rule:** Prefer overwriteable buffers for sensitive intermediates.
- Decrypt into `Uint8Array`.
- Only decode to string in a tight scope (render/search snippet creation).
- Avoid storing decrypted strings in caches, Maps, histories, or DOM attributes.

---

## B) Search without caching plaintext

### B1) Query-time scan (decrypt per chunk, keep only hits metadata)
**Rule:** Search must not require cached full plaintext.
- On each search query:
  - Decrypt chunks one-by-one.
  - Search within the chunk plaintext.
  - Keep only `(chunkId, offsets, preview)` in memory.
  - Immediately discard plaintext for that chunk.
- When user opens a search result:
  - Re-decrypt only that chunk (or needed chunk range) and render.

Expected behavior:
- You still create plaintext briefly, but you avoid “whole-doc in RAM.”
- Search is slower, but memory footprint and plaintext residency are reduced.

### B2) Optional encrypted search index (built at encryption time)
**Goal:** Search without decrypting everything.

**Rule:** If an index exists, it must not leak readable terms.
- Build at encryption/packaging time:
  - Tokenize terms per chunk.
  - Store a keyed token representation (e.g., `HMAC(key, term)`), mapping to chunk IDs.
- At query time:
  - Compute keyed token for the query term(s).
  - Use index to find candidate chunk IDs.
  - Decrypt only matching chunks for preview/render.
  - Discard plaintext immediately.

Notes:
- Closest you get to “search” with less plaintext exposure.
- Index design must consider:
  - frequency leakage (repeated terms → repeated HMAC tokens),
  - dictionary guessing (mitigated by keyed HMAC, not eliminated),
  - token normalization (case, punctuation, locale).

---

## C) Prevent OS persistence of sensitive pages (constraints + expectations)

This is mostly outside a browser app’s control, but agents must not worsen it and should document it.

### C1) Swap/pagefile exposure (OS-level)
- Native apps can `mlock`/`VirtualLock` to reduce swapping; browsers generally can’t.
- Rely on:
  - full-disk encryption,
  - swap/pagefile encryption,
  - sane OS policies.

### C2) Crash dumps / diagnostics
- Hardened daemons can mark memory non-dumpable; browsers generally can’t.
- Avoid:
  - verbose logs,
  - storing sensitive strings in exceptions,
  - leaking sensitive data into DOM attributes that tools might serialize.

---

## D) Hardware/OS-backed isolation (threat-model dependent)
These are architecture changes, not quick patches.

### D1) TEEs (enclave-style)
- Run sensitive operations in a protected enclave (SGX/SEV/TrustZone-like).
- In-browser: limited; treat as research/future, not default.

### D2) HSM / smartcards
- Keep keys and some operations off-host.
- Host never sees key material, but plaintext still appears if displayed.

### D3) Remote rendering / VDI
- Secret stays remote; local sees pixels.
- Stronger against local disk/RAM, weaker against screen capture and trust in remote.

---

## E) Protected rendering paths (mostly DRM territory)
- “Protected media path” / GPU overlay ideas keep frames in restricted pipelines.
- Not reliable for general text in web apps; OS-level capture can still win.
- Do not add fake “anti-screenshot” theater; it’s conspicuous and usually ineffective.

---

## F) Don’t store; derive
**Rule:** Prefer recomputation over plaintext caching.
- Keep encrypted-at-rest only.
- Decrypt only when strictly needed.
- Use short timeouts and quick purges.
- Use ephemeral session keys when possible; re-derive rather than keep long-lived derived material.

---

## Codebase conventions
- Prefer vendored, pinned dependencies for deterministic builds (avoid surprise CDN fetches).
- Keep `Content-Security-Policy` tight; don’t widen it casually.
- Any new feature must include:
  - a “data lifetime” note (what data exists where, for how long),
  - a “persistence” note (what could be written to disk by browser/OS),
  - a “network” note (what requests happen, when, and why).

---

## What to leave alone unless there’s a concrete reason
- Crypto primitives and parameters (e.g., AES-GCM + PBKDF2) unless changing with a migration plan.
- CSP and no-store/no-cache behavior.
- “No server” design constraint.

---

## How to propose changes as an agent
When making edits, include a short note in the PR/commit message:
- “Plaintext residency reduced because …”
- “Persistence unchanged / reduced because …”
- “UI made more neutral by changing …”
- “No new network endpoints added.”

---

## Review checklist for any change
1) Does this introduce any plaintext markdown fetching/parsing from `.md`?
2) Does this store decrypted strings/HTML anywhere beyond the immediate render step?
3) Does it keep full-document plaintext in memory at any point?
4) Does search avoid plaintext caches (or is plaintext caching explicitly opt-in)?
5) Do copy/export re-decrypt on demand rather than using stored plaintext?
6) Does this write anything sensitive to:
   - Cache Storage (service worker),
   - LocalStorage/IndexedDB/sessionStorage,
   - URL (query/hash),
   - console logs,
   - DOM attributes that might get serialized?
7) Are decrypted bytes scrubbed where feasible (`Uint8Array.fill(0)`), and are large immutable strings avoided?
8) Does the change introduce OS persistence risk (storage, logs, caches, SW cache)?
9) Does UI wording or visuals make the app look like a “secret tool”?
10) Are encryption parameters/versioning backwards compatible (or cleanly rejected)?
