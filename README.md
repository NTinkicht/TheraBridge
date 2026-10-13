# CareBridge V1 Flow Map

An interactive map of every V1 workflow in the CareBridge Figma prototype, published with GitHub Pages and refreshed from Figma by a GitHub Action.

- **`site/index.html`** is the page: journeys, a diagram per journey, walk mode, every screen, and the changes since the last refresh.
- **`site/data/latest.json`** holds the screens and prototype links read from Figma. After a change, the previous version is kept in `previous.json`.
- **`scripts/extract.mjs`** reads the 13 canonical pages through the Figma REST API. It needs Node 18 or later and has no dependencies. It only reads; it never writes to Figma.
- **`.github/workflows/refresh.yml`** runs the script every day at 06:00 Dubai time and whenever you press **Run workflow**. It commits new data only if the prototype changed, then publishes `site/`.

## One-time setup (about 10 minutes)

1. **Create the repository** on GitHub and push these files to `main`.
   - Pages from a private repository needs a paid GitHub plan.
   - The published site is public either way. Anyone with the link can see screen names, titles and the review notes in the page. The page asks search engines not to index it, but that is not access control.

2. **Create a read-only Figma token.**
   - In Figma, go to **Settings → Security → Personal access tokens → Generate new token**.
   - Give it only the **File content: Read-only** scope (`file_content:read`) and set an expiry date.
   - Copy the token; Figma shows it once.
   - The token can read every file your Figma account can open, so keep it only in the repository secret below.

3. **Add the token as a repository secret.**
   - Go to **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIGMA_TOKEN`. Value: the token.

4. **Turn on Pages.**
   - Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

5. **Run the first refresh.**
   - Go to **Actions → Refresh flow map → Run workflow**.
   - After a minute or two the site is live at `https://<your-user>.github.io/<repo>/`.

## Refreshing

- **Automatically:** the workflow runs every day at 06:00 Dubai time. To change the time, edit the `cron` line in `refresh.yml`; GitHub reads it as UTC.
- **On demand:** press **Refresh from Figma ↗** on the page. This opens the workflow on GitHub, where you press **Run workflow**. You need write access to the repository. The page updates about two minutes later.
- **The run log** lists each page with its screen and link counts, and warns if a page has disappeared from the file.

### Optional repository variables

Set these under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Default | Use |
|---|---|---|
| `FIGMA_FILE_KEY` | `34FdCEFoEc7lZ2sVHmCkge` | Read a different file or branch (for a branch, use the branch key). |
| `FIGMA_PAGES` | the 13 canonical pages | Comma-separated page IDs to read, e.g. `271:2,302:2`. |

## Running it on your computer

```bash
FIGMA_TOKEN=xxxx node scripts/extract.mjs        # updates site/data/latest.json
npx serve site                                   # or any static file server
node test/test-extract.mjs                       # offline tests with a mocked Figma API
```

## Editing the journeys

The journeys, the protected, server-decided and missing links, the owner decisions (D1–D11) and the per-screen issue notes are set by hand. They live in `site/index.html` in the `JOURNEYS`, `ISSUES` and `DECISIONS` constants.

Screens and wired links always come from Figma. If someone wires a link in Figma that a journey marks as missing, the map shows it as wired after the next refresh. If a listed screen is deleted, the journey reports it as no longer in the file.

## Troubleshooting

| What the run log says | What to do |
|---|---|
| `FIGMA_TOKEN is not set` | Add the repository secret (step 3). |
| `Figma refused the token (403)` | The token expired, lacks the `file_content:read` scope, or its account cannot open the file. Create a new token and update the secret. |
| `Figma could not find the file (404)` | Check `FIGMA_FILE_KEY`. |
| `these pages are no longer in the file` | A page was deleted or recreated. Update `FIGMA_PAGES`, and the journeys if needed. |
| Deploy job fails at "configure-pages" | Pages is not set to **GitHub Actions** (step 4). |
