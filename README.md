# InkStone Preview

Edit a note on the left. See the real page on the right.

[InkStone](https://github.com/airenare/inkstone) turns an Obsidian vault into a website, but Obsidian's reading view doesn't render notes the way InkStone does. Indentation, line breaks, headings and callouts can all come out different. This plugin closes that gap: it runs InkStone on your machine and shows the actual rendered page in a pane next to your note. There's no commit, push and wait cycle to find out how a post will look.

- **The real site, not an approximation.** The plugin never re-implements rendering. It's InkStone's own output.
- **Live.** Save a note and the preview reloads itself. No refresh button.
- **Two-way navigation.** Open a note and the preview shows its page. Click a link in the preview and the editor opens that note. Check slugs, links and language variants the way a visitor would.
- **Private notes, both ways.** The preview shows what a visitor sees. Flip on **Owner view** to see the content as the site owner.
- **Git without leaving Obsidian.** Pull, review diffs, commit and push your site folder from inside Obsidian, using the git setup you already have. No tokens to paste.

> **Early release (0.x).** It's been tested by the author on macOS and Linux. Windows is supported in the code and covered by unit tests, but nobody has run it live yet. Expect a few rough edges, and please [open an issue](https://github.com/airenare/inkstone-obsidian-plugin/issues) when you hit one.

## Requirements

- **Obsidian desktop.** Mobile isn't supported, because the plugin starts a local process.
- **A local [InkStone](https://github.com/airenare/inkstone) checkout, version 1.57.0 or newer,** with its Python environment set up (by default, a `.venv` inside the checkout). If you don't have it yet, clone it from [github.com/airenare/inkstone](https://github.com/airenare/inkstone) and follow its README to install the requirements. The plugin reads the checkout's `VERSION` file and tells you to `git pull` if it's older. Version 1.58.2 or newer is recommended. It stops the server with Obsidian even after a crash or force-quit (1.58.0), stops reloading the whole site every time Obsidian or git touches its own files, which was making previews feel slow (1.58.1), and fixes a security hole where a deployed site could serve private files (1.58.2).
- **`git`,** if you want the git panel.

## Install

**From Obsidian (recommended).** Open Settings > Community plugins, turn off Restricted mode if it's on, choose **Browse**, search for **InkStone Preview**, then **Install** and **Enable**. You can also open the plugin's [page in the community directory](https://community.obsidian.md/plugins/inkstone-preview) and click **Add to Obsidian**.

**Manual.** Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/airenare/inkstone-obsidian-plugin/releases/latest) into `<your vault>/.obsidian/plugins/inkstone-preview/`, then enable **InkStone Preview** under Settings > Community plugins.

**BRAT (for betas).** To try a pre-release before it reaches the store, add `airenare/inkstone-obsidian-plugin` in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin. Most people don't need this.

## Quick start

1. Open Settings > **InkStone Preview**.
2. Set **InkStone folder** to the folder where you cloned [InkStone](https://github.com/airenare/inkstone) (the one with `app.py`), using **Browse** or by typing the path. The Python path fills in on its own.
3. Set **Site folder** to the folder that holds your site notes. Click **Choose from vault** to pick it from your vault's folder tree (the vault root is there too), or **Browse** to pick any folder on disk. You can also type a path: `~/notes/site` works, and so does a path relative to your vault (a single dot means the vault root). The settings page tells you right away if something's wrong.
4. Click the globe icon in the ribbon, or run the command **Open preview**.
5. Open any note in the site folder. The preview shows its page. Edit, save, and watch it update.

The site folder works the same way InkStone's vault does: files at the top level become `/slug`, a `blog/` folder becomes `/blog/...`, and so on.

## Build a site from scratch

You can start with an empty folder. The plugin writes the notes for you, and the preview shows each one as you go. It only ever writes frontmatter (plus a starter heading) into new notes. It never edits an existing note, except to insert a link when you ask it to. Creating notes needs the **site folder to be inside the vault**; a site folder outside the vault still previews, but the create commands are off.

**First run.** If no InkStone checkout or site folder is set, the pane says "Set up InkStone" and points you to the settings. Once both are set and the site folder has no homepage, it says "This site has no homepage yet" and offers a **Create homepage** button. After that, the pane's empty state offers buttons for the other note types.

**Commands.** Each one opens a small form, writes one new note and opens it:

| Command | What it writes |
| --- | --- |
| Create homepage | A `type: homepage` note at the site root. Asks for the site language, default theme, and whether to show Search and Tags links. |
| Create page | A regular page, with optional tags and summary. |
| Create book | A page with `type: book`. |
| Create listing | A `type: listing` index for a folder (cards for every post in it). |
| Create feed | A `type: feed` stream for a folder (excerpts with "Read more"). |
| Create secondary homepage | A homepage for a section folder, with its own site title, icon and theme. The icon is a plain text field: a path relative to the vault, such as `_attachments/logo.png`. |
| Create translations note | The UI strings for one language (see below). |
| Create language variant | A translated copy of the open note (see below). |

You pick the folder (the current one, an existing one, or a new one inside the site folder). The title is kept exactly as you type it. The filename drops characters that aren't allowed in file names. If you tick **Insert a link to it in the open note**, a wiki link is added at the cursor of the note you had open.

**Private pages.** Switch on **Private** and the page isn't published (`website: true` is left out). It gets an `access_token:` instead, and you share it as `/slug?token=...`. **The token is stored in plain text in the note.** If the site folder is in a public git repo, anyone can read it. Use private pages only when the repo is private. A private page never goes in the navigation.

**Navigation.** Pages, books and the like get an **Add to navigation** checkbox, which writes `menu_order` so the page is pinned to the top bar. Listings, feeds and secondary homepages already appear in the bar, so for those the checkbox reads **Hide from navigation** and writes `nav_hidden: true`. The page stays reachable by its link.

**Languages.** A language variant copies the open note's `website`, `title`, `slug`, `date`, `tags`, `summary` and `type`, and adds `lang:`. It's served at `/{slug}/{lang}`, and InkStone adds the language toggle. Set `slug:` in the original note before you translate a variant's title. InkStone derives the slug from the title otherwise, and the two variants would stop matching. A translations note holds the site's interface strings (Search, Tags, Read more...) for one language. Russian is bundled, so a Russian note comes pre-filled. For any other language you get the key list to fill in. Tick **Also create translations note** in the variant form to make both at once; an existing one for that language is reused.

**Git, from nothing.** In the git panel, a folder that isn't a repo shows **Initialize repository**, and a repo without a remote shows a **Remote URL** field with **Set remote**. After that, Commit and Push work as described below.

## Deploy

The plugin doesn't deploy anything. When the site is in a git repo with a remote, deploying is InkStone's job: run the InkStone Docker image on Coolify or any Docker host, set `VAULT_REPO` to the repo's URL so the image clones it, and point a GitHub webhook at `/webhook` (with `WEBHOOK_SECRET`) so a push updates the live site. The details are in [InkStone's docs](https://github.com/airenare/inkstone), under Docker and Production Deployment.

## Settings

| Setting | What it does |
| --- | --- |
| Site folder | The folder with your site notes. Pick it from the vault's folder tree with **Choose from vault**, browse to a folder on disk, or type a path: absolute, `~/...`, or relative to the vault (`.` is the vault root). A folder outside the vault still previews, but auto-reload and editor sync only work inside the vault, because Obsidian only reports changes to vault files. |
| InkStone folder | The folder where you cloned [InkStone](https://github.com/airenare/inkstone), the one with `app.py`. |
| Python executable | Defaults to the checkout's venv: `<checkout>/.venv/bin/python3` on macOS and Linux, `<checkout>\.venv\Scripts\python.exe` on Windows. It needs InkStone's requirements installed. |
| Start server automatically | Starts the preview server when Obsidian opens. Otherwise it starts the first time you open the preview. |

Change the site folder, checkout or Python path while the server's running and the plugin restarts it for you.

There's also a command, **Restart server**, and the preview toolbar shows the server status with a Restart button if it ever crashes.

## The preview pane

The toolbar shows the current URL (never the Owner token), a status dot, and the **Owner view** checkbox.

- **Unpublished notes** (no `website: true`) show a "not published" message instead of a stale page. `.base` and `.canvas` files publish when their name ends in `__website`.
- **Notes outside the site folder** get a short note saying so.
- **Links that leave the site** open in your system browser, for `http`, `https` and `mailto` only.
- **Errors** (a crashed server, a bad frontmatter) show up in the pane with the server's own output, so you can see what InkStone said.

## Git panel

Expand **Git** under the toolbar. It lists changed files (all checked by default), shows a diff when you click one, and takes a commit message ("Update site content" by default). Commit sends exactly the files you checked. It doesn't push for you.

What the buttons do depends on the state of the site folder:

| Folder state | Pull | Commit | Push |
| --- | --- | --- | --- |
| No site folder set | Disabled ("Site folder not set") | Disabled (same hint) | Disabled (same hint) |
| Not a git repo | Disabled ("Folder is not a git repo") | Disabled (same hint) | Disabled (same hint) |
| Repo, no remote | Disabled ("No remote configured") | Enabled | Disabled ("No remote configured") |
| Repo with a remote | Enabled | Enabled | Enabled |

Hover a disabled button to see why. The preview works in every state. A few details worth knowing:

- Git runs in your site folder with your own git config and credentials. The plugin never asks for or stores a token. It also never prompts: if your remote needs a password it can't get on its own, the command fails with git's message instead of hanging.
- If the site folder is a subfolder of a bigger repo, the panel only lists and commits changes inside the site folder.
- Pull is `git pull --rebase`. Push never forces.
- Errors show git's own text, unedited. Huge or binary diffs are truncated or skipped.

## Privacy and security

- The plugin never stores credentials. The Owner view token is random, kept in memory, and only sent to the local InkStone server the plugin started.
- The plugin-started server also gets a random `WEBHOOK_SECRET`, so its `/webhook` endpoint can't be used to run `git pull` in your notes.
- The preview server only listens on `127.0.0.1`, on a random port.
- The server is started with a pipe on its stdin that Obsidian keeps open. When Obsidian exits for any reason, the pipe closes and InkStone (1.58.0 or newer) shuts itself down.
- The dev source-map endpoint (what lets clicks in the preview open the right note) exists only when the plugin starts InkStone itself with `INKSTONE_DEV_API=1`. A server you run on your own doesn't have it.

## Disclosures

Obsidian asks plugin authors to be upfront about a few things. Here's all of it.

- **Network use.** The plugin itself doesn't contact any remote service. It talks only to the InkStone server it starts on `127.0.0.1`. Two things can still reach the network on your behalf: the pages InkStone renders can load whatever your site's theme and settings include (for example Giscus comments or web fonts), and the git panel runs your own `git`, which contacts your git remote when you click Pull or Push.
- **Files outside your vault.** [InkStone](https://github.com/airenare/inkstone) is a separate program, so the plugin has to reach outside the vault. It reads the **site folder** you choose, which can be anywhere on disk. It checks the **InkStone folder** (`app.py` and `VERSION`) and runs Python from it. It runs `git` in the site folder, and only changes anything when you click Commit, Pull or Push. The plugin never edits your notes itself, apart from the new notes you ask it to create and a link you ask it to insert.
- **Runs other programs.** It starts your Python (running InkStone) and `git` as child processes. Both are stopped when Obsidian closes.
- **No account, payment, ads or telemetry.** The plugin sends nothing anywhere, and it never installs or updates itself or any dependency.
- **Open source.** MIT licensed, readable source, no obfuscation.
- **Platforms.** Desktop only. Tested on macOS and Linux; Windows is untested.
- **Not affiliated with Obsidian.** InkStone Preview is an independent community plugin.

## Troubleshooting

| You see | What to do |
| --- | --- |
| "No app.py found in ..." | Point **InkStone folder** at the repository root, the folder that contains `app.py`. |
| "InkStone x.y.z found; this plugin needs 1.57.0 or newer" | `git pull` in your [InkStone](https://github.com/airenare/inkstone) checkout. |
| A Python or Flask error in the settings | Install InkStone's requirements into the Python you chose (`pip install -r requirements.txt`), or point **Python executable** at the right venv. |
| "Not published" in the pane | The note needs `website: true` in its frontmatter. For `.base` and `.canvas` files, rename them to end with `__website`. |
| The preview doesn't reload when you save | Auto-reload needs the site folder to be inside the vault. A folder outside it still previews, but you'll need to reload by hand. |
| Clicking a link takes a second or two to show the page | Update InkStone to 1.58.1 or newer. Older versions reload the whole site each time Obsidian rewrites its own `.obsidian/` files. Still slow? Run the command **Copy preview timing log** right after clicking and paste the result into an issue. It shows where the time went (the click, the editor, the server's reply, the page itself). |
| A git timeout on a remote that uses SSH | Git may be waiting on a passphrase or host-key prompt it can't show. Load the key into your ssh-agent, or run `git push` once in a terminal. |

## Known limitations

- On InkStone 1.57.x, a hard-killed Obsidian (crash or force-quit) can leave the local server running until you end it yourself. InkStone 1.58.0 and newer shut the server down with Obsidian in every case.
- A `.env` file in the InkStone checkout that sets `URL_PATH_PREFIX` isn't supported.
- Windows hasn't been run live yet. Reports are welcome.

## Development

```bash
npm install
npm test
npm run build
```

Use Node 20 (see `.nvmrc`). To try your build in Obsidian, symlink this folder into a test vault's `.obsidian/plugins/` as `inkstone-preview`, enable the plugin, and reload it after each build.

### Releasing

Bump `version` in `manifest.json` and `package.json`, add it to `versions.json`, then push a tag that equals that version exactly, with no `v` prefix (for example `0.1.0`). The release workflow fails if the tag and `manifest.json` disagree.

## License

MIT. See [LICENSE](LICENSE).
