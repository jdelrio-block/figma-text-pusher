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
Bridge server running on :3001
WebSocket server listening on :1994/ws
```

### 5. Run the plugin in Figma

In your Figma file: **Plugins → Development → Text Pusher**

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

See all text nodes on the current page and what text they contain:

```bash
./cli/push.sh --list
```

Output:
```
Text nodes on current page:
  • hero_title                    "Welcome to Neighborhoods"
  • hero_subtitle                 "Manage your local community"
  • cta_primary                   "Get Started"

3 node(s) total
```

Filter by frame:
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

Output:
```
Renaming 3 layer(s) in Figma…

  ✅ "Text 47"  →  "hero_title"
  ✅ "Text 48"  →  "hero_subtitle"
  ✅ "Text 49"  →  "cta_primary"

Done: 3 renamed, 0 not found
```

**Typical workflow for a new file:**
```bash
./cli/push.sh --list          # see current layer names + content
# create rename.json mapping old names → semantic names
./cli/push.sh --rename rename.json   # rename them all at once
./cli/push.sh my-copy.json    # now push your content
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
- Case-sensitive (`hero_title` ≠ `Hero_Title`)
- No extra spaces
- Use `--list` to see the exact names before pushing

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Bridge server: ✗ not running` | Run `cd server && ./node_modules/.bin/ts-node index.ts` |
| `No Figma plugin connected` | Open your Figma file, run **Plugins → Development → Text Pusher** |
| `0 updated, 5 not found` | Layer names don't match — use `--list` to see actual names, then `--rename` |
| Plugin shows "Disconnected" | Restart the bridge server, then re-run the plugin |

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
