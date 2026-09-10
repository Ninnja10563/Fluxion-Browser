// Test-only commands operate on a controlled loopback document. No script
// evaluation, arbitrary selectors, filesystem paths, or content callbacks.
export class FluxionBrowsingVerificationChild extends JSWindowActorChild {
  receiveMessage(message) {
    const { origin } = message.data || {};
    const document = this.document;
    const window = this.contentWindow;
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "") || window.location.origin !== origin) {
      throw new Error("Browsing verification origin mismatch");
    }
    if (message.name === "FluxionBrowsing:Read") {
      return {
        url: document.documentURI, title: document.title,
        text: document.body?.textContent?.slice(0, 4000) || "",
        script: document.documentElement.dataset.fixtureScript || "",
        cookie: document.cookie,
      };
    }
    const logout = message.name === "FluxionBrowsing:Logout";
    if (window.location.pathname !== (logout ? "/account" : "/")) throw new Error("Unexpected fixture form document");
    let form;
    if (logout) {
      form = document.querySelector("#logout-form");
      if (!form || form.action !== `${origin}/logout` || form.method !== "post") throw new Error("Unexpected logout fixture form");
    } else if (message.name === "FluxionBrowsing:Login") {
      form = document.querySelector("#login-form");
      if (!form || form.action !== `${origin}/login` || form.method !== "post") throw new Error("Unexpected login fixture form");
      form.elements.namedItem("username").value = "fluxion";
      form.elements.namedItem("password").value = "fixture-only";
    } else if (message.name === "FluxionBrowsing:Upload") {
      form = document.querySelector("#upload-form");
      const file = message.data.file;
      if (!form || form.action !== `${origin}/upload` || form.method !== "post" ||
          form.enctype !== "multipart/form-data" || file?.name !== "fluxion-download.txt") {
        throw new Error("Unexpected upload fixture form or file");
      }
      const input = form.elements.namedItem("file");
      if (!input || input.type !== "file") throw new Error("Missing native file input");
      input.mozSetFileArray([file]);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      if (input.files.length !== 1 || input.files[0].size !== file.size) throw new Error("Native file input did not accept the downloaded file");
    } else {
      throw new Error("Unsupported browsing verification command");
    }
    // Let the actor reply settle before the real document form navigates away.
    window.setTimeout(() => form.requestSubmit(), 0);
    return { submitted: true };
  }
}
