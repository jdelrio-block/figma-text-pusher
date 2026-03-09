# Figma Text Pusher

Update text in Figma designs by editing a JSON file — no clicking required.

---

## How it works

```
You edit a JSON file  →  run push.sh  →  text updates in Figma instantly
```

Three pieces work together:
- **Bridge server** — runs locally, relays messages between your terminal and Figma
- **Figma plugin** — sits inside Figma, receives instructions and updates text nodes
- **CLI script** — what you actually run to push changes, list layers, or rename them

---

## Setup

### Prerequisites
- [Node.js](https://nodejs.org) (v18+) — check with `node --version`
- A Figma account (any plan)

### 1. Clone the repo

```bash
git clone https://github.com/jdelrio-block/figma-text-pusher.git
cd figma-text-pusher
```

### 2. Install server dependencies

```bash
cd server && npm install --registry https://registry.npmjs.org
```

> **Block/Square employees:** Your machine uses a private npm registry by default. The `--registry` flag overrides it for this install. You only need to run this once.

### 3. Load the plugin in Figma

1. Open Figma
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select `plugin/manifest.json` from this repo

> The plugin will now appear under **Plugins → Development → Text Pusher**

### 4. Start the bridge server

Open a Terminal tab and keep it running:

```bash
cd server && ./node_modules/.bin/ts-node index.ts
```

You should see:
```
WebSocket server listening on :1994/ws
Bridge server running on :3001
```

> Keep this tab open the whole time — the server must stay running for pushes to work.

### 5. Run the plugin in Figma

Open your Figma file, then: **Plugins → Development → Text Pusher**

The plugin window should show **Connected**.

---

## Usage

### Push text changes

Create a JSON file with layer names as keys and new text as values:

```json
{
  "hero_title": "Welcome to Neighborhoods",
  "hero_subtitle": "Manage your local community",
  "cta_primary": "Get Started",
  "cta_secondary": "Learn More",
  "body_description": "Everything you need in one place"
}
```

Then push it:

```bash
./cli/push.sh your-copy.json
```

Output:
```
Pushing 5 keys to Figma…

  ✅ hero_title             → "Welcome to Neighborhoods"
  ✅ hero_subtitle          → "Manage your local community"
  ✅ cta_primary            → "Get Started"
  ✅ cta_secondary          → "Learn More"
  ✅ body_description       → "Everything you need in one place"

Done: 5 updated, 0 not found, 0 errors
```

---

### List text layers (with content preview)

See all text nodes on the current page and what text they currently contain:

```bash
./cli/push.sh --list
```

Filter by frame (strongly recommended for large files):
```bash
./cli/push.sh --list --frame "Landing Page"
```

---

### Rename layers automatically

When your layers have generic names (`Text 47`, `Frame 12/Text`, etc.), create a rename mapping:

```json
{
  "Text 47": "hero_title",
  "Text 48": "hero_subtitle",
  "Text 49": "cta_primary"
}
```

Run:
```bash
./cli/push.sh --rename rename.json
```

**Typical workflow for a new file with messy layer names:**
```bash
./cli/push.sh --list --frame "My Frame"   # see current layer names + content
# create rename.json mapping old names → semantic names
./cli/push.sh --rename rename.json        # rename them all at once in Figma
./cli/push.sh my-copy.json               # push your content
```

---

### Health check

```bash
./cli/push.sh --health
```

Output:
```
Bridge server: ✅ running on :3001
Plugin:        ✅ connected
Page:          "Landing Page"
Text nodes:    12
```

---

## Layer naming rules

The JSON key must **exactly match** the Figma layer name:

- **Case-sensitive** — `hero_title` ≠ `Hero_Title`
- **No extra spaces**
- **Curly apostrophes** — Figma uses `'` (Unicode `\u2019`), not a straight `'`. If a push returns "not found" but you can see the layer exists, this is almost certainly why. Copy the layer name directly from Figma's layers panel rather than typing it manually.
- **Auto-rename after push** — Figma automatically renames a text layer to match its new content after you update it. This means the layer name changes after a successful push. If you push the same key again later, use `--list` to confirm the current name.
- **Generic names hit everything** — Layer names like `Paragraph`, `Label`, or `Text` often exist hundreds of times in a large file. Always use `--list --frame "Frame Name"` to scope your work before pushing, or you'll update every matching layer across the whole page.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Bridge server: ✗ not running` | Run `cd server && ./node_modules/.bin/ts-node index.ts` |
| `listen EADDRINUSE :::1994` or `:::3001` | Ports already in use from a previous run. Kill them: `lsof -ti :3001 -ti :1994 \| xargs kill -9` then restart the server |
| `npm install` hangs or fails | Add `--registry https://registry.npmjs.org` to the install command |
| `No Figma plugin connected` | Open your Figma file, run **Plugins → Development → Text Pusher**, wait for "Connected" |
| `0 updated, N not found` | Layer names don't match — use `--list` to see actual names. Check for curly apostrophes. |
| Layer name changed after push | Figma auto-renames layers when content changes. Run `--list` to get the new name. |
| Plugin shows "An error occurred" | Close and reopen the plugin. If it persists, restart the bridge server first. |
| Plugin shows "Disconnected" | Restart the bridge server, then reopen the plugin in Figma |
| Push updated way more layers than expected | A generic layer name (`Paragraph`, `Label`) matched many nodes. Cmd+Z in Figma to undo, then scope with `--frame` |
| Slow response on large files (1000+ nodes) | Normal — the plugin searches the whole page. Run `--health` first to confirm the plugin is responsive. |

---

## Project structure

```
figma-text-pusher/
├── cli/
│   └── push.sh          # CLI: push, list, rename, health
├── plugin/
│   ├── manifest.json    # Figma plugin config
│   ├── ui.html          # Plugin UI (WebSocket client)
│   └── code.js          # Plugin logic (text updates, renaming)
├── server/
│   ├── index.ts         # Bridge server (WebSocket + HTTP)
│   └── package.json
└── test-copy.json       # Example copy file
```
