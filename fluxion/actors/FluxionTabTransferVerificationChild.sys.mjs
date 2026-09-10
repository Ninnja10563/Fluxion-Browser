// Fixed loopback-only commands; no arbitrary selectors, scripts, or privileged
// objects are exposed to webpage code.
export class FluxionTabTransferVerificationChild extends JSWindowActorChild {
  receiveMessage(message) {
    const { origin } = message.data || {};
    const window = this.contentWindow, document = this.document;
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "") ||
        window.location.origin !== origin || window.location.pathname !== "/transfer" ||
        document.title !== "Fluxion transfer fixture") throw new Error("Transfer fixture origin/document mismatch");
    const draft = document.getElementById("draft"), button = document.getElementById("increment");
    if (draft?.localName !== "textarea" || button?.localName !== "button") throw new Error("Transfer fixture controls missing");
    if (message.name === "FluxionTabTransfer:Seed") {
      draft.value = "Unsaved transfer draft — café";
      button.click();
      window.history.pushState(null, "", "?step=1");
    } else if (message.name !== "FluxionTabTransfer:Read") throw new Error("Unsupported transfer fixture command");
    return {
      url: window.location.href, nonce: document.documentElement.dataset.nonce,
      draft: draft.value, counter: Number(window.wrappedJSObject.transferFixtureCounter),
      historyLength: window.history.length,
    };
  }
}
