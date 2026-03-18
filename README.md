# mcp-devcon2026

## Deploy to GitHub Pages

This repository now includes a GitHub Actions workflow at `.github/workflows/pages.yml`
that builds VitePress and deploys `.vitepress/dist` to GitHub Pages.

### Triggering deploys

- Automatic deploy on pushes to `main`
- Manual deploy with workflow dispatch from the Actions tab

### Required repository settings

1. In GitHub, open `Settings -> Pages`.
2. Set `Source` to `GitHub Actions`.
3. Ensure Actions has permission to deploy Pages for this repository.

### Base path configuration

VitePress base path is controlled by the environment variable
`VITEPRESS_BASE_PATH`.

- If your Pages URL is at the domain root, leave it unset (defaults to `/`).
- If your internal Pages URL serves the site under a subpath, set repo variable:
	- Name: `VITEPRESS_BASE_PATH`
	- Value example: `/mcp-devcon2026/`

You can set repository variables under `Settings -> Secrets and variables -> Actions -> Variables`.

This lets you keep internal hosting now and switch URL strategy later without
changing content or workflow structure.

### Local build

```bash
npm ci
npm run build
```

Build output is generated in `.vitepress/dist`.