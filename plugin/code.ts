// Figma Plugin — code.ts
// Handles messages relayed from ui.html (which receives them over WebSocket).

figma.showUI(__html__, { width: 280, height: 104, title: "Text Pusher" });

figma.ui.onmessage = async (msg: {
  type: string;
  id: string;
  data?: Record<string, string> | { frame?: string };
}) => {
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
      const frameFilter = (data as { frame?: string })?.frame;
      let textNodes: TextNode[];

      if (frameFilter) {
        const frame = figma.currentPage.findOne(
          (n) => n.type === "FRAME" && n.name === frameFilter
        ) as FrameNode | null;
        textNodes = frame
          ? (frame.findAllWithCriteria({ types: ["TEXT"] }) as TextNode[])
          : [];
      } else {
        textNodes = figma.currentPage.findAllWithCriteria({
          types: ["TEXT"],
        }) as TextNode[];
      }

      respond(id, { nodes: textNodes.map((n) => n.name) });
      return;
    }

    if (type === "update_text") {
      const updates = data as Record<string, string>;
      const results: Array<{
        key: string;
        status: "updated" | "not_found" | "error";
        error?: string;
      }> = [];

      for (const [key, value] of Object.entries(updates)) {
        const nodes = figma.currentPage.findAllWithCriteria({
          types: ["TEXT"],
        }) as TextNode[];

        const matching = nodes.filter((n) => n.name === key);

        if (matching.length === 0) {
          results.push({ key, status: "not_found" });
          continue;
        }

        for (const node of matching) {
          try {
            // Load all fonts used in this text node
            const fontNames = new Set<string>();
            if (node.fontName !== figma.mixed) {
              fontNames.add(JSON.stringify(node.fontName));
            } else {
              const len = node.characters.length;
              for (let i = 0; i < len; i++) {
                const fn = node.getRangeFontName(i, i + 1);
                if (fn !== figma.mixed) {
                  fontNames.add(JSON.stringify(fn));
                }
              }
            }

            for (const fnStr of fontNames) {
              await figma.loadFontAsync(JSON.parse(fnStr) as FontName);
            }

            node.characters = value;
            results.push({ key, status: "updated" });
          } catch (err: unknown) {
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

    // Unknown message type
    respond(id, { error: "unknown_type" });
  } catch (err: unknown) {
    respond(id, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

function respond(id: string, data: unknown) {
  figma.ui.postMessage({ type: "response", id, data });
}
