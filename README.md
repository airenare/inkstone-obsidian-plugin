# InkStone Preview

Edit a note on the left. See the real page on the right.

[InkStone](https://github.com/airenare/inkstone) turns an Obsidian vault into a website, but Obsidian's reading view doesn't render notes the way InkStone does. Indentation, line breaks, headings and callouts can all come out different. This plugin closes that gap: it runs InkStone on your machine and shows the actual rendered page in a pane next to your note. There's no commit, push and wait cycle to find out how a post will look.

- **The real site, not an approximation.** The plugin never re-implements rendering. It's InkStone's own output.
- **Live.** Save a note and the preview reloads itself. No refresh button.
- **Two-way navigation.** Open a note and the preview shows its page. Click a link in the preview and the editor opens that note. Check slugs, links and language variants the way a visitor would.
- **Private notes, both ways.** The preview shows what a visitor sees. Flip on **Owner view** to see the content as the site owner.
- **Git without leaving Obsidian.** Pull, review diffs, commit and push your site folder from inside Obsidian, using the git setup you already have. No tokens to paste.

> **Early release (0.x).** It's been tested by the author on macOS. Linux and Windows are supported in the code and covered by unit tests, but nobody has run them live yet. Expect a few rough edges, and please [open an issue](https://github.com/airenare/inkstone-obsidian-plugin/issues) when you hit one.

## Requirements

- **Obsidian desktop.** Mobile isn't supported, because the plugin starts a local process.
- **A local [InkStone](https://github.com/airenare/inkstone) checkout, version 1.57.0 or newer,** with its Python environment set up (by default, a `.venv` inside the checkout). If you don't have it yet, clone it from [github.com/airenare/inkstone](https://github.com/airenare/inkstone) and follow its README to install the requirements. The plugin reads the checkout's `VERSION` file and tells you to `git pull` if it's older. Version 1.58.0 or newer is recommended: it makes the server stop with Obsidian even after a crash or force-quit.
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
- **Files outside your vault.** [InkStone](https://github.com/airenare/inkstone) is a separate program, so the plugin has to reach outside the vault. It reads the **site folder** you choose, which can be anywhere on disk. It checks the **InkStone folder** (`app.py` and `VERSION`) and runs Python from it. It runs `git` in the site folder, and only changes anything when you click Commit, Pull or Push. The plugin never edits your notes itself.
- **Runs other programs.** It starts your Python (running InkStone) and `git` as child processes. Both are stopped when Obsidian closes.
- **No account, payment, ads or telemetry.** The plugin sends nothing anywhere, and it never installs or updates itself or any dependency.
- **Open source.** MIT licensed, readable source, no obfuscation.
- **Not affiliated with Obsidian.** InkStone Preview is an independent community plugin.

## Troubleshooting

| You see | What to do |
| --- | --- |
| "No app.py found in ..." | Point **InkStone folder** at the repository root, the folder that contains `app.py`. |
| "InkStone x.y.z found; this plugin needs 1.57.0 or newer" | `git pull` in your [InkStone](https://github.com/airenare/inkstone) checkout. |
| A Python or Flask error in the settings | Install InkStone's requirements into the Python you chose (`pip install -r requirements.txt`), or point **Python executable** at the right venv. |
| "Not published" in the pane | The note needs `website: true` in its frontmatter. For `.base` and `.canvas` files, rename them to end with `__website`. |
| The preview doesn't reload when you save | Auto-reload needs the site folder to be inside the vault. A folder outside it still previews, but you'll need to reload by hand. |
| A git timeout on a remote that uses SSH | Git may be waiting on a passphrase or host-key prompt it can't show. Load the key into your ssh-agent, or run `git push` once in a terminal. |

## Known limitations

- On InkStone 1.57.x, a hard-killed Obsidian (crash or force-quit) can leave the local server running until you end it yourself. InkStone 1.58.0 and newer shut the server down with Obsidian in every case.
- A `.env` file in the InkStone checkout that sets `URL_PATH_PREFIX` isn't supported.
- Linux and Windows haven't been run live yet. Reports are welcome.

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
