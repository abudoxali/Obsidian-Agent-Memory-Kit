# VYMEM — Brand Identity & Public Repository Creative Brief

**Status:** Proposed working brand, subject to final trademark/domain/package clearance and owner approval.  
**Product category:** Local-first shared-memory toolkit for coding agents.  
**Origin:** Extracted from the private ABUD Knowledge Universe architecture, not the private vault or its data.  
**Existing GitHub destination:** `abudoxali/Obsidian-Agent-Memory-Kit` (keep the remote name and URL unchanged until separately approved).  
**Public description:** A local-first, evidence-backed memory layer for coding agents using Obsidian, MCP, and lifecycle hooks.

## 1. Naming

- **Product name:** VYMEM
- **Pronunciation:** “VY-mem” (ڤاي مِم)
- **CLI candidate:** `vymem` (only if command/package availability permits; otherwise use a namespaced command).
- **Repository name:** Preserve `Obsidian-Agent-Memory-Kit`; brand label can differ from repo slug.
- **Descriptor:** Shared memory for coding agents.
- **Internal mnemonic:** VYMEM = *verified, yours, memory* (marketing mnemonic, not a formal acronym).
- **Avoid:** claiming its name is legally clear; trademark registration, domains, npm namespace, and package ownership still require checks.

## 2. Product positioning

**Problem:** Engineering context is fragmented across coding-agent sessions.  
**Answer:** A local, inspectable knowledge layer built from Markdown in the user's own Obsidian vault, with MCP retrieval and source-backed handoffs.  
**Technical differentiator:** Provenance + explicit approval boundaries, not an uncontrolled “AI knows everything” promise.  
**Audience:** Individual developers, AI-assisted software teams, developer tooling maintainers.  
**Voice:** Precise, capable, calm, developer-first. Avoid hype, absolute privacy guarantees, and unverified support claims.

## 3. Visual system

**Concept:** Three independent agents linked to one memory core. A circular central node encodes the shared local knowledge base; three satellites represent separate agent runtimes. Directed lines show retrieval and evidence-based handoff.

| Token | Value | Use |
| --- | --- | --- |
| Midnight | `#090D19` | Backgrounds |
| Deep panel | `#111831` | Cards, stage surfaces |
| Electric violet | `#8B5CF6` | Primary accent and memory core |
| Soft lavender | `#BCA6FF` | Core highlight |
| Teal | `#2DD4BF` | Agent A, read events |
| Blue | `#60A5FA` | Agent B, work events |
| Orchid | `#A78BFA` | Agent C, captures |
| Off-white | `#F8FAFC` | Primary text |
| Slate | `#98A6C2` | Secondary text |

**Fonts (do not bundle proprietary binaries):** Inter or Segoe UI for interface and headings; IBM Plex Sans Arabic for Arabic materials where licensed; JetBrains Mono or Consolas for CLI/snippets. Use legal/system fallback stacks.

**Logo rules:** Maintain the three-agent topology and one central core. Reserve clear space of at least 0.25× icon width. Do not place thin lines on visually noisy backgrounds. No unauthorized Obsidian, Anthropic, Google, or OpenAI marks in the custom logo. Do not recolor clients' trademarks as your own.

**Supplied SVG assets:**
- `assets/vymem-mark.svg` — symbolic icon.
- `assets/vymem-horizontal.svg` — wordmark with technical descriptor.
- `assets/github-banner.svg` — README header banner (concept illustration, not a real screenshot).

Assets are initial vector directions. Review at 32px and mobile README scale before adopting. Export PNGs as needed and test accessible contrast.

## 4. Product information architecture

**README order:** brand banner → plain-English problem → 30-second concept video (if GitHub-hosted preview supports it) → architecture diagram → feature scope → compatibility matrix → quick start → install/uninstall → example vault → privacy and security boundaries → evidence/screenshots → contribution and license.

**Docs:**
- `docs/architecture.md`
- `docs/installation.md`
- `docs/how-it-works.md`
- `docs/compatibility.md`
- `docs/security.md`
- `docs/brand/BRAND_IDENTITY.md` (this document)
- `docs/showcase/` (reviewed screenshots, captions and provenance manifest)

**CLI:** `init`, `doctor`, `status`, `install`, `uninstall` are names to implement only when real functionality supports them. Never invent commands in README.

## 5. Screenshots and examples: evidence requirements

Use **real** Obsidian and client captures from the local production showcase as visual evidence **only after privacy-safe curation**. Never include an entire original vault, raw state database, raw logs, fixture transcripts with private paths, machine inventory, personal file lists, project/client names, or screenshots that reveal such details.

1. Copy selected screenshots into a **local staging folder outside Git**; never stage originals.
2. Make a per-image review manifest: original path (locally only), proposed public filename, source/date, classification `real_sanitized_capture` or `synthetic_demo`, exact redactions, associated verified claim, owner-review state.
3. Replace sensitive UI regions using **opaque pixel masks or crops**, not blur alone. Review small zoom and image metadata. Do not leak private names, project graphs, host paths, repo names, account identifiers, notifications, avatars, labels, hidden panes, or QR codes.
4. Mark published real screenshots clearly as `Sanitized capture from a private deployment`; synthetic visuals as `Illustrative demo`. Never conflate them.
5. Keep raw and pending-review screenshots *out of the public repository and its history*. The owner must approve the final sanitized contact sheet before any real screenshot is pushed to a public branch.
6. Alternatively: reproduce the same functional views using a synthetic demo vault for screenshot-heavy sections, while showing one or two heavily sanitized real captures after review.
7. Repository README should explain why production data is intentionally excluded.

**Recommended public gallery:** Architecture flow diagram (synthetic), sanitized Obsidian galaxy, sanitized MCP/skills registry, synthetic example project memory, synthetic handoff sequence, optional 30-second explainer video. Never publish actual internal project metrics or device inventory unless specifically approved.

## 6. Example brand messaging

- Short summary: **“Shared memory for coding agents, stored in your Obsidian vault.”**
- Technical summary: **“Automatic context retrieval, source-backed handoffs, and owner-approved knowledge through a local MCP gateway.”**
- Design note: Keep labels factual. The kit must not claim all three clients work automatically on every platform and version; maintain a tested compatibility matrix.

## 7. GitHub brand deliverables

- README hero/brand assets; `.github` social-preview-ready banner.
- `docs/brand/BRAND_IDENTITY.md`, SVG logo mark/wordmark, favicon exports.
- Synthetic screenshot examples and architecture diagrams.
- Carefully staged, redacted real captures pending owner review.
- Public-ready software distribution with no production vault dependency.
- Complete secret/history/media scan, docs, CI and tests before publication.
- Attribution to the origin project only if permitted, without exposing personal environment details.

## 8. Release criteria

- Clean temporary vault / HOME installation works with original production vault unavailable.
- Basic MCP search and context works with synthetic data.
- Agent hooks are opt-in and uninstaller reversible.
- All included screenshots have reviewed provenance and no identifiable private data.
- No credentials, IPs, environment values, personal usernames, or production histories in code, docs, or Git objects.
- No retroactive claim of broad OS compatibility; only tested client versions shown.
- Public README links resolve to actual repo files.
- Third-party code and assets have auditable licenses.

**Owner sign-off needed before pushing any sanitized real production screenshot.**
