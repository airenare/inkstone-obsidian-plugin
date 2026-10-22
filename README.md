# InkStone for Obsidian

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
- **A local InkStone checkout, version 1.57.0 or newer,** with its Python environment set up (by default, a `.venv` inside the checkout). The plugin reads the checkout's `VERSION` file and tells you to `git pull` if it's older.
- **`git`,** if you want the git panel.

## Install

**BRAT.** Add `airenare/inkstone-obsidian-plugin` in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin. It installs the latest release and keeps it updated.

**Manual.** Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/airenare/inkstone-obsidian-plugin/releases/latest) into `<your vault>/.obsidian/plugins/inkstone-preview/`, then enable **InkStone** under Settings > Community plugins.

## Quick start

1. Open Settings > **InkStone**.
2. Set **InkStone checkout** to the folder where you cloned InkStone (the one with `app.py`). The Python path fills in on its own.
3. Set **Site folder** to the folder that holds your site notes. Use **Browse**, or type a path. `~/notes/site` works, and so does a path relative to your vault. The settings page tells you right away if something's wrong.
4. Click the globe icon in the ribbon, or run the command **Open InkStone preview**.
5. Open any note in the site folder. The preview shows its page. Edit, save, and watch it update.

The site folder works the same way InkStone's vault does: files at the top level become `/slug`, a `blog/` folder becomes `/blog/...`, and so on.

## Settings

| Setting | What it does |
| --- | --- |
| Site folder | The folder with your site notes. Accepts absolute paths, `~/...` paths, and paths relative to the vault. A folder outside the vault still previews, but auto-reload and editor sync only work inside the vault, because Obsidian only reports changes to vault files. |
| InkStone checkout | The folder where you cloned InkStone. |
| Python executable | Defaults to the checkout's venv: `<checkout>/.venv/bin/python3` on macOS and Linux, `<checkout>\.venv\Scripts\python.exe` on Windows. It needs InkStone's requirements installed. |
| Start server automatically | Starts the preview server when Obsidian opens. Otherwise it starts the first time you open the preview. |

Change the site folder, checkout or Python path while the server's running and the plugin restarts it for you.

There's also a command, **Restart InkStone server**, and the preview toolbar shows the server status with a Restart button if it ever crashes.

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
- The dev source-map endpoint (what lets clicks in the preview open the right note) exists only when the plugin starts InkStone itself with `INKSTONE_DEV_API=1`. A server you run on your own doesn't have it.

## Troubleshooting

| You see | What to do |
| --- | --- |
| "No app.py found in ..." | Point **InkStone checkout** at the repository root, the folder that contains `app.py`. |
| "InkStone x.y.z found; this plugin needs 1.57.0 or newer" | `git pull` in your InkStone checkout. |
| A Python or Flask error in the settings | Install InkStone's requirements into the Python you chose (`pip install -r requirements.txt`), or point **Python executable** at the right venv. |
| "Not published" in the pane | The note needs `website: true` in its frontmatter. For `.base` and `.canvas` files, rename them to end with `__website`. |
| The preview doesn't reload when you save | Auto-reload needs the site folder to be inside the vault. A folder outside it still previews, but you'll need to reload by hand. |
| A git timeout on a remote that uses SSH | Git may be waiting on a passphrase or host-key prompt it can't show. Load the key into your ssh-agent, or run `git push` once in a terminal. |

## Known limitations

- Links with `target="_blank"` (social links, the footer, some canvas links) do nothing in the preview.
- If Obsidian is hard-killed (a crash or force-quit), the local server can keep running until you end it yourself.
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
