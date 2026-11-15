# Precise Reading Edit

Double-click text or a formula in Obsidian's Reading view to edit it at the corresponding Markdown source position. The plugin switches to Editing view only when it can verify the destination. Otherwise, it keeps your current view and scroll position.

## Usage

1. Enable the plugin and open a note in Reading view.
2. Double-click the heading, text, or formula you want to edit. The plugin also checks text and formulas inside callouts, quotes, list items, and table cells, as well as the text of ordinary code blocks. A verified formula opens at its first `$`.
3. Links, embeds, callout headers, and other controls keep their usual interactions. If the plugin cannot verify a source position, use Obsidian's view switcher to enter Editing view manually.

Precise Reading Edit requires **Obsidian desktop 1.15.1 or later**. If another plugin also handles double-clicks in Reading view, disable that gesture or pause the other plugin to avoid conflicts.

The double-click workflow was inspired by Click to Edit. This plugin is an independent implementation that uses Obsidian's section information to find the Markdown source position. [Click to Edit](https://github.com/alpppine/click-to-edit)

## Manual installation

1. Download `main.js` and `manifest.json` from the same release. [GitHub releases](https://github.com/speam/precise-reading-edit/releases)
2. Place both files in `.obsidian/plugins/precise-reading-edit/` inside your vault. Create the directory if needed.
3. In Obsidian, open **Settings → Community plugins**, refresh the plugin list, and enable **Precise Reading Edit**.

## Privacy

All position matching runs locally using the current note's Markdown source and rendered sections. The plugin requires no account, makes no network requests, collects no telemetry, and accesses only the current vault.

## Development

```sh
npm ci
npm test
npm run build
```

## License

[MIT](LICENSE)
