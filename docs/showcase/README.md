# Showcase

Everything published here is **synthetic**, a diagram, brand artwork, or one of two owner-approved sanitized real captures. Each is labelled accordingly.

| File | Label | What it shows | Supports |
| --- | --- | --- | --- |
| [`demo-terminal.svg`](demo-terminal.svg) | **Illustrative demo** | Rendered from [`demo-transcript.txt`](demo-transcript.txt), the real output of `examples/run-demo.mjs` (real vault files, git repositories, MCP processes) on a synthetic vault with two fictional projects. Agents are scripted MCP clients. | Handoff, cross-agent retrieval, dedup, conflicts, protected records, owner-only approval are implemented and exercised. |
| [`../architecture.svg`](../architecture.svg) | **Illustrative diagram** | Component overview. | Design as implemented in `src/`. |
| [`../handoff-workflow.svg`](../handoff-workflow.svg) | **Illustrative diagram** | Message sequence of demo steps 2-8. | Behaviour of `submit_knowledge_entry`, `get_project_context`, `vymem approve`. |
| [`../../assets/`](../../assets/) | Brand artwork | Logo mark, horizontal logo, README banner, social preview. | Identity only; not evidence of anything. |

Regenerate the demo images:

```bash
node examples/run-demo.mjs --quiet --transcript docs/showcase/demo-transcript.txt
node scripts/render-transcript.mjs docs/showcase/demo-transcript.txt docs/showcase/demo-terminal.svg
```

## Real captures from the private deployment

| File | Label | Shows | Redactions | Status |
| --- | --- | --- | --- | --- |
| [`../screenshots/galaxy-sanitized.png`](../screenshots/galaxy-sanitized.png) | *Sanitized capture from a private deployment.* | the origin vault as a 3D knowledge graph in Obsidian | cropped to the graph; 5 opaque masks over project-name labels | owner-approved 2026-11-12 |
| [`../screenshots/handoff-sanitized.png`](../screenshots/handoff-sanitized.png) | *Sanitized capture from a private deployment.* | a hook-written, unapproved handoff from a fixture repository | cropped to the evidence section; opaque mask over a record identifier | owner-approved 2026-11-12 |

These are captures of the **origin deployment**, not of this standalone release, and they are not evidence that VYMEM works with any live client. The other 12 origin screenshots (hardware and infrastructure inventory, repository counts, project names) and all raw captures are **not** in this repository or its history. Hashes, metadata checks and review status are in [`provenance-manifest.json`](provenance-manifest.json); `npm test` fails if an image under `docs/screenshots/` is missing from the manifest or its hash differs.
