export class FluxionMemoryPageChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== "FluxionMemory:Extract") return null;
    const document = this.document;
    const window = this.contentWindow;
    if (!document || !/^https?:$/.test(window.location.protocol)) return null;
    if (String(document.designMode).toLowerCase() === "on") return null;

    // Rich-text drafts are user input just like form fields. Exclude the whole
    // subtree, including read-only islands inside an editor. Invalid editable
    // attribute values are conservatively omitted as well.
    const editable = '[contenteditable]:not([contenteditable="false" i])';
    const source = document.querySelector("article, main") || document.body;
    if (!source || source.isContentEditable || source.closest(editable)) return null;

    const description = document.querySelector('meta[name="description" i]')?.content ||
      document.querySelector('meta[property="og:description" i]')?.content || "";
    const clone = source?.cloneNode(true);
    clone?.querySelectorAll("script, style, noscript, nav, footer, form, input, textarea, select, button").forEach(node => node.remove());
    clone?.querySelectorAll(editable).forEach(node => node.remove());
    // Heading evidence must use the same sanitized tree as body evidence.
    const headings = [...clone.querySelectorAll("h1, h2")]
      .slice(0, 24)
      .map(node => node.textContent);
    clone?.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, pre, section, article, div, br")
      .forEach(node => node.append(document.createTextNode(" ")));

    return {
      url: document.documentURI,
      title: document.title,
      description,
      headings,
      text: clone?.textContent || "",
      language: document.documentElement.lang || "",
      hasPasswordField: Boolean(document.querySelector('input[type="password"]')),
    };
  }
}
