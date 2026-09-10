// No file paths, File construction, file injection, arbitrary selectors, or
// script evaluation. Only the native OS picker may populate this input.
export class FluxionFilePickerVerificationChild extends JSWindowActorChild {
  receiveMessage(message) {
    const { origin } = message.data || {};
    const document = this.document;
    const window = this.contentWindow;
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "") || window.location.origin !== origin) {
      throw new Error("Native picker fixture origin mismatch");
    }
    const page = { url: document.documentURI, title: document.title };
    if (window.location.pathname === "/file-picker-upload" && message.name === "FluxionFilePicker:Read") return page;
    if (window.location.pathname !== "/file-picker") throw new Error("Unexpected native picker document");
    const form = document.getElementById("file-picker-form");
    const input = form?.elements.namedItem("file");
    if (!form || form.action !== `${origin}/file-picker-upload` || form.method !== "post" ||
        form.enctype !== "multipart/form-data" || input?.type !== "file") {
      throw new Error("Unexpected native picker form contract");
    }
    if (!this.events) {
      this.events = { cancel: 0, change: 0, input: 0, untrusted: 0 };
      for (const type of ["cancel", "change", "input"]) {
        input.addEventListener(type, event => {
          if (event.target !== input) return;
          if (event.isTrusted) this.events[type] += 1;
          else this.events.untrusted += 1;
        });
      }
    }
    if (message.name === "FluxionFilePicker:Focus") {
      input.scrollIntoView({ block: "center", behavior: "instant" });
      input.focus();
    } else if (message.name === "FluxionFilePicker:Submit") {
      if (input.files.length !== 1 || this.events.cancel !== 1 || this.events.change !== 1 || this.events.input !== 1 || this.events.untrusted) {
        throw new Error("Native picker has not produced the required trusted selection");
      }
      window.setTimeout(() => form.requestSubmit(), 0);
    } else if (message.name !== "FluxionFilePicker:Read") {
      throw new Error("Unsupported native picker command");
    }
    return { ...page, focused: document.activeElement === input && document.hasFocus(),
      events: { ...this.events }, files: [...input.files].map(file => ({ name: file.name, size: file.size })) };
  }
}
