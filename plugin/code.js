// Figma Plugin — code.js (compiled from code.ts)
// If you edit code.ts, recompile with: npx tsc --target ES2020 --module commonjs code.ts

figma.showUI(__html__, { width: 280, height: 104, title: "Text Pusher" });

figma.ui.onmessage = async (msg) => {
  const { type, id, data } = msg;

  try {
    if (type === "health_check") {
      const textNodes = figma.currentPage.findAllWithCriteria({ types: ["TEXT"] });
      respond(id, {
        page: figma.currentPage.name,
        textNodeCount: textNodes.length,
      });
      return;
    }

    if (type === "list_nodes") {
      const frameFilter = data && data.frame;
      let textNodes;

      if (frameFilter) {
        const frame = figma.currentPage.findOne(
          (n) => n.type === "FRAME" && n.name === frameFilter
        );
        textNodes = frame
          ? frame.findAllWithCriteria({ types: ["TEXT"] })
          : [];
      } else {
        textNodes = figma.currentPage.findAllWithCriteria({ types: ["TEXT"] });
      }

      respond(id, {
        nodes: textNodes.map((n) => ({
          name: n.name,
          content: n.characters.slice(0, 80),
        })),
      });
      return;
    }

    if (type === "rename_nodes") {
      const mapping = data; // { "old_name": "new_name" }
      const results = [];

      for (const [oldName, newName] of Object.entries(mapping)) {
        const nodes = figma.currentPage
          .findAllWithCriteria({ types: ["TEXT"] })
          .filter((n) => n.name === oldName);

        if (nodes.length === 0) {
          results.push({ oldName, newName, status: "not_found" });
          continue;
        }

        for (const node of nodes) {
          node.name = newName;
          results.push({ oldName, newName, status: "renamed" });
        }
      }

      respond(id, { results });
      return;
    }

    if (type === "update_text") {
      const updates = data;
      const targetNames = new Set(Object.keys(updates));
      const results = [];

      // Single traversal — collect only nodes whose names we care about
      const matchedNodes = figma.currentPage.findAll(
        (n) => n.type === "TEXT" && targetNames.has(n.name)
      );

      // Group by name
      const byName = {};
      for (const node of matchedNodes) {
        if (!byName[node.name]) byName[node.name] = [];
        byName[node.name].push(node);
      }

      for (const [key, value] of Object.entries(updates)) {
        const nodes = byName[key] || [];

        if (nodes.length === 0) {
          results.push({ key, status: "not_found" });
          continue;
        }

        for (const node of nodes) {
          try {
            // Use getStyledTextSegments for efficient font detection (avoids char-by-char loop)
            const fontNames = new Set();
            if (node.fontName !== figma.mixed) {
              fontNames.add(JSON.stringify(node.fontName));
            } else {
              const segments = node.getStyledTextSegments(['fontName']);
              for (const seg of segments) {
                if (seg.fontName) fontNames.add(JSON.stringify(seg.fontName));
              }
            }

            for (const fnStr of fontNames) {
              try {
                await figma.loadFontAsync(JSON.parse(fnStr));
              } catch (_) {
                // Font already loaded or unavailable — try to continue anyway
              }
            }

            node.characters = value;
            results.push({ key, status: "updated" });
          } catch (err) {
            results.push({
              key,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      respond(id, { results });
      return;
    }

    respond(id, { error: "unknown_type" });
  } catch (err) {
    respond(id, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

function respond(id, data) {
  figma.ui.postMessage({ type: "response", id, data });
}
