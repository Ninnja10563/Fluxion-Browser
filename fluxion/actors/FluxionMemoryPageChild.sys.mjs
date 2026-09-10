const MAX_NODES = 4096;
const MAX_TEXT = 24000;
const MAX_HEADINGS = 24;
const MAX_HEADING_TEXT = 240;
const EDITABLE = '[contenteditable]:not([contenteditable="false" i])';
const EXCLUDED = new Set([
  "script", "style", "noscript", "nav", "footer", "form", "input", "textarea", "select", "button",
]);
const BLOCKS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "blockquote", "pre",
  "section", "article", "main", "div", "br", "tr", "td", "th",
]);

function readableEvidence(source, nodeLimit = MAX_NODES, textLimit = MAX_TEXT) {
  const text = [], headings = [];
  let visited = 0, length = 0, activeHeading = null;
  const stack = [{ node: source, entered: false }];
  function append(value) {
    const part = value.slice(0, textLimit - length);
    if (!part) return;
    text.push(part);
    length += part.length;
    if (activeHeading && activeHeading.text.length < MAX_HEADING_TEXT) {
      activeHeading.text += part.slice(0, MAX_HEADING_TEXT - activeHeading.text.length);
    }
  }

  // Frames retain only the next sibling, not all children of a wide element.
  // No recursion, layout reads, full subtree strings or cloned DOM are needed.
  while (stack.length && visited < nodeLimit && length < textLimit) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    if (!frame.entered) {
      visited++;
      frame.entered = true;
      if (node.nodeType === 3) {
        // CharacterData.substringData bounds the native read itself, unlike
        // reading an arbitrarily large data/textContent value and slicing it.
        append(node.substringData(0, textLimit - length));
        stack.pop();
        continue;
      }
      if (node.nodeType !== 1) { stack.pop(); continue; }
      const tag = node.localName;
      if (EXCLUDED.has(tag) || node.matches(EDITABLE)) {
        stack.pop();
        continue;
      }
      frame.block = BLOCKS.has(tag);
      if (frame.block) append(" ");
      if ((tag === "h1" || tag === "h2") && !activeHeading && headings.length < MAX_HEADINGS) {
        frame.heading = { text: "" };
        headings.push(frame.heading);
        activeHeading = frame.heading;
      }
      frame.child = node.firstChild;
    } else if (frame.child) {
      const child = frame.child;
      frame.child = child.nextSibling;
      stack.push({ node: child, entered: false });
    } else {
      if (frame.block) append(" ");
      if (frame.heading) activeHeading = null;
      stack.pop();
    }
  }
  return {
    text: text.join(""),
    headings: headings.map(heading => heading.text.replace(/\s+/g, " ").trim()).filter(Boolean),
  };
}

export class FluxionMemoryPageChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== "FluxionMemory:Extract") return null;
    const document = this.document;
    const window = this.contentWindow;
    if (!document || !/^https?:$/.test(window.location.protocol)) return null;
    if (String(document.designMode).toLowerCase() === "on") return null;

    // Native source/password selectors remain document-wide. Evidence walking
    // itself is bounded, and editable ancestors reject read-only draft islands.
    const source = document.querySelector("article, main") || document.body;
    if (!source || source.isContentEditable || source.closest(EDITABLE)) return null;

    const description = document.querySelector('meta[name="description" i]')?.content ||
      document.querySelector('meta[property="og:description" i]')?.content || "";
    const title = document.querySelector("title");
    const evidence = readableEvidence(source);

    return {
      url: document.documentURI,
      title: title ? readableEvidence(title, 64, 300).text.replace(/\s+/g, " ").trim() : "",
      description: description.slice(0, 1000),
      headings: evidence.headings,
      text: evidence.text,
      language: (document.documentElement.lang || "").slice(0, 32),
      hasPasswordField: Boolean(document.querySelector('input[type="password"]')),
    };
  }
}
