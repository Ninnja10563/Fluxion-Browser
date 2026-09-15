# Product service policy

Fluxion reuses Mozilla Gecko and Firefox's mature browser services. It does not
offer Mozilla's Firefox VPN subscription/enrollment product. The native VPN
promotion is therefore disabled, not relabeled as a Fluxion service. Independent
VPN applications, proxy configuration and installed WebExtensions are unaffected.

## Pinned Gecko 155.0.1 integration

The reviewed upstream sources are the `FIREFOX_155_0_1_RELEASE` tag:

- [IPProtectionService.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/toolkit/components/ipprotection/IPProtectionService.sys.mjs)
  checks `browser.ipProtection.enabled` before initializing its helpers. Its
  preference observer also tears down the service when this gate becomes false.
- [IPProtection.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/browser/components/ipprotection/IPProtection.sys.mjs)
  declares the widget ID `ipprotection-button` and panel ID `PanelUI-ipprotection`.
  The earlier Fluxion selector `ip-protection-button` did not match that widget.
- [IPPOptOutHelper.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/browser/components/ipprotection/IPPOptOutHelper.sys.mjs)
  changes toolbar placement when the user opt-out preference changes. Fluxion
  deliberately does not use that preference as a product feature gate.

`runtime/fluxion.cfg` applies the policy before browser-window injection, setting
both the default and user values of `browser.ipProtection.enabled` to false and
locking the preference. This covers an existing profile with the feature enabled
and prevents a later experiment or inherited user value from reintroducing the
unsupported Firefox enrollment UI. This is product configuration, not a record
of the user's consent or an instruction to delete service data.

The policy does not erase VPN sessions, credentials, toolbar placement, proxy
settings, extensions, browsing data or Firefox account state. Mozilla attribution
and license access remain in About Fluxion; engine/security diagnostics retain
their upstream terminology where technically accurate.

`tests/product-policy.test.js` executes the shipped startup function against fresh
and existing preference stores, including a stale re-enable attempt and checks
that unrelated settings remain untouched. Native macOS validation must additionally
check the effective locked gate and absence of the promotion on the actual Gecko
window. Re-review the gate and widget/panel IDs whenever updating the engine lock.

Fluxion also disables `browser.urlbar.groupLabels.enabled`, the native switch
for the marketing-style "Firefox Suggest" group heading. Real bookmark/history
results, their source icons/text and native query providers are retained. The
outer native URL-bar surface owns the popup's single frame; Fluxion does not
wrap the results in a second bordered panel.
