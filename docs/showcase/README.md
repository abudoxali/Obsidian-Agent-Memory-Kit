# Showcase

Everything published here is either **synthetic** or a diagram. It is labelled accordingly. No screenshot of the private deployment VYMEM came from is included.

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

The origin system has 14 real Obsidian screenshots (knowledge graph, registries, sentinel views, hook-written handoffs). They contain personal project names, hardware and infrastructure inventory, repository counts and the owner's environment, so none are published. Two sanitized candidates (a cropped, masked graph view and a cropped, masked hook-written handoff) are held **outside this repository** pending the owner's explicit approval. If approved, they will be added with the caption *"Sanitized capture from a private deployment."* and a manifest entry with `classification: real_sanitized_capture`.

See [`provenance-manifest.json`](provenance-manifest.json) for the machine-readable record, including the review status of every item.
