# P8-B Docs site compatible with pmndrs/docs
Status: ready for review
Changed: `docs/guide/*.md` -> `*.mdx` (git mv; frontmatter added, H1 removed, links ported); `.github/workflows/docs.yml` (new); `scripts/check-docs.mjs`; link updates in `README.md` and `packages/{runtime,three,react}/README.md` (guide pointers now `.mdx`, anchors in pmndrs slugs).
Verified:
- `node scripts/check-docs.mjs --build` -> meta: 6 pages, 0 problems; links: 119, 0 broken; samples: 22 extracted (the `{/* doc-preamble */}` form works), `tsc` passed; `@pmndrs/docs@3 build` compiled all 6 pages.
- Full website: `npx @pmndrs/docs@3 build docs/guide <scratch>/out-site --format website` (Next static export, env as in the workflow) succeeded in 16 s: routes `/getting-started /api /authoring /quality-and-performance /demos /credits`, plus `llms.txt`. Nothing committed.
- `pnpm check` -> exit status 0 (run unpiped to a log file).
Measures:
- Frontmatter per page: `title`, `description` (quoted, they contain colons or `@`), `nav` 0..5 (getting-started, api, authoring, quality-and-performance, demos, credits). Flat pages, no subfolders; `home_redirect: '/getting-started'`.
- Workflow: `pmndrs/docs/.github/workflows/build.yml@v3` (as asked; v4 also exists and is the current one, the `version` input defaults differ), `mdx: 'docs/guide'`, `libname: 'Clouds'`, `libname_short: 'clouds'`, icon, `github`, push trigger on `main` plus `workflow_dispatch`, deploy job as in r3f.
- Links: guide-to-guide links are `./page.mdx#anchor`; links to repo files are `https://github.com/pmndrs/clouds/blob|tree/main/<path>`. No images in the guide, so none moved.
- `check-docs` now: `--meta` (frontmatter title/description/integer unique nav), `--links` (resolves `.mdx`; absolute links under `GITHUB_BASE` must exist in the checkout and use branch `main`), `--samples` (fences in `.mdx`; preamble as `{/* doc-preamble ... */}`; HTML `<!-- -->` form still accepted), `--build` (optional, needs network, runs the real pmndrs compile into `work/captures/scratch/docs-build`).
Open issues:
- Repo URL is a placeholder (`github.com/pmndrs/clouds`). Change it in `GITHUB_BASE` in `scripts/check-docs.mjs` (single constant), `github:` in `.github/workflows/docs.yml`, and re-run a find/replace over the absolute links in `docs/guide/*.mdx` (the check lists any that no longer match).
- MDX gotchas now apply to the guide: no HTML comments (use `{/* */}`), no bare `<https://...>` autolinks, no bare `{` or `<tag>` outside code. The `--build` flag catches these.
- pmndrs heading ids keep punctuation (`#@clouds/three`, `#in-browser-.vdb-import`) unlike GitHub's; anchors in the guide and README pointers use pmndrs slugs. GitHub shows `.mdx` as source, so README links to the guide open the file and the anchors only work on the built site.
- Not done: Pages must be enabled in the repo settings; `.mdx` links from READMEs will need to become site URLs once the URL is final. The sky/nav `logo` input is unset (default `/logo.png` is absent; r3f ships its own).

## Orchestrator review
Accepted. `check-docs` re-run independently (6 pages, 119 links, 22 samples, tsc passing). Kept `@v3` to match react-three-fiber; moving to v4 is a later choice. The repo URL is still a placeholder (`GITHUB_BASE`), pending the owner.
