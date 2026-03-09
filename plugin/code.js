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

      respond(id, { nodes: textNodes.map((n) => n.name) });
      return;
    }

    if (type === "update_text") {
      const updates = data;
      const results = [];

      for (const [key, value] of Object.entries(updates)) {
        const nodes = figma.currentPage
          .findAllWithCriteria({ types: ["TEXT"] })
          .filter((n) => n.name === key);

        if (nodes.length === 0) {
          results.push({ key, status: "not_found" });
          continue;
        }

        for (const node of nodes) {
          try {
            // Collect all font names used in this text node
            const fontNames = new Set();
            if (node.fontName !== figma.mixed) {
              fontNames.add(JSON.stringify(node.fontName));
            } else {
              for (let i = 0; i < node.characters.length; i++) {
                const fn = node.getRangeFontName(i, i + 1);
                if (fn !== figma.mixed) fontNames.add(JSON.stringify(fn));
              }
            }

            for (const fnStr of fontNames) {
              await figma.loadFontAsync(JSON.parse(fnStr));
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
