# InkStone for Obsidian

Preview your notes as they will look on your InkStone site, without leaving Obsidian. The plugin runs a local InkStone server (the Python Flask blog engine) and shows the rendered note in a pane.

## Requirements

- Obsidian desktop only (the plugin starts a local process, so mobile is not supported).
- InkStone 1.57.0 or newer, as a local checkout.
- Python, to run the InkStone server.

## Notes

- Git operations use your own git setup. The plugin does not store any tokens or credentials.

## Development

```bash
npm install
npm test
npm run build
```
