export class FluxionMemoryPageChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== "FluxionMemory:Extract") return null;
    const document = this.document;
    const window = this.contentWindow;
    if (!document || !/^https?:$/.test(window.location.protocol)) return null;

    const description = document.querySelector('meta[name="description" i]')?.content ||
      document.querySelector('meta[property="og:description" i]')?.content || "";
    const headings = [...document.querySelectorAll("main h1, main h2, article h1, article h2, body > h1")]
      .slice(0, 24)
      .map(node => node.textContent);
    const source = document.querySelector("article, main") || document.body;
    const clone = source?.cloneNode(true);
    clone?.querySelectorAll("script, style, noscript, nav, footer, form, input, textarea, select, button").forEach(node => node.remove());
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
