#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native tab adoption requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-tab-transfer-check.XXXXXX")"
profile="$check_root/profile"
browser_log="$check_root/browser.log"
server_log="$check_root/server.log"
browser_pid=""
server_pid=""
keyboard_dir="$check_root/keyboard"
keyboard_log="$check_root/keyboard.log"
last_keyboard_sequence=0
cleanup() {
  for pid in "$browser_pid" "$server_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for ((stop_attempt=0; stop_attempt<40; stop_attempt++)); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [[ -n "${FLUXION_TAB_TRANSFER_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_TAB_TRANSFER_ARTIFACT_DIR"
    for log in "$browser_log" "$server_log" "$keyboard_log"; do
      [[ ! -f "$log" ]] || cp "$log" "$FLUXION_TAB_TRANSFER_ARTIFACT_DIR/tab-transfer-$(basename "$log")"
    done
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'user_pref("fluxion.tabTransfer.verification.' "$profile/prefs.js" > "$FLUXION_TAB_TRANSFER_ARTIFACT_DIR/tab-transfer-evidence.txt" || true
    fi
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-tab-transfer-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe transfer cleanup path: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
mkdir -p "$keyboard_dir"
node "$fluxion_root/scripts/tab-transfer-fixture.mjs" 0 >"$server_log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  if [[ -s "$server_log" ]]; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { cat "$server_log" >&2; exit 1; }
  sleep 0.1
done
origin="$(node -e 'const f=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]); if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(f.origin))throw Error("Invalid transfer fixture origin");console.log(f.origin)' "$server_log")"
FLUXION_PROFILE="$profile" FLUXION_TAB_TRANSFER_TEST=1 FLUXION_TAB_TRANSFER_ORIGIN="$origin" \
  FLUXION_TAB_TRANSFER_KEYBOARD_DIR="$keyboard_dir" \
  "$launcher" about:blank >"$browser_log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<1200; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    keyboard_request="$(sed -nE 's/^user_pref\("fluxion\.tabTransfer\.verification\.keyboardRequest", "([0-9]+):(activate|open|down|right|escape)"\);$/\1:\2/p' "$profile/prefs.js")"
    if [[ -n "$keyboard_request" ]]; then
      keyboard_sequence="${keyboard_request%%:*}"
      keyboard_action="${keyboard_request#*:}"
      if (( keyboard_sequence > last_keyboard_sequence )); then
        (( keyboard_sequence == last_keyboard_sequence + 1 && keyboard_sequence <= 128 )) || {
          printf 'Native keyboard handshake sequence is invalid.\n' >&2; break;
        }
        if [[ "$keyboard_action" == activate ]]; then
          /usr/bin/osascript -e "tell application \"System Events\" to set frontmost of first application process whose unix id is $browser_pid to true" >>"$keyboard_log" 2>&1 || break
        else
          case "$keyboard_action" in
            open) keyboard_command='key code 109 using {shift down}' ;;
            down) keyboard_command='key code 125' ;;
            right) keyboard_command='key code 124' ;;
            escape) keyboard_command='key code 53' ;;
            *) printf 'Unrecognized native keyboard operation.\n' >&2; break ;;
          esac
          /usr/bin/osascript -e 'tell application "System Events"' \
            -e "if (unix id of (first application process whose frontmost is true)) is not $browser_pid then error \"Transfer fixture lost foreground ownership\"" \
            -e "$keyboard_command" -e 'end tell' >>"$keyboard_log" 2>&1 || {
              printf 'Native keyboard operation failed for owned transfer process.\n' >&2; break;
            }
        fi
        touch "$keyboard_dir/$keyboard_sequence.sent"
        last_keyboard_sequence="$keyboard_sequence"
      fi
    fi
    if grep -Fq 'user_pref("fluxion.tabTransfer.verification.health", "native-adoption-live-state-privacy-and-detach-verified")' "$profile/prefs.js" &&
       grep -Fq 'shipped-flow-context-menu-dom-command-adopts-live-document' "$profile/prefs.js" &&
       grep -Fq 'native-os-keyboard-tab-and-group-menu-open-navigation-and-escape-focus' "$profile/prefs.js"; then
      printf 'Native tab adoption retained live documents, history, pin/container/workspace state, privacy boundaries, and detached windows.\n' >&2
      grep 'user_pref("fluxion.tabTransfer.verification.' "$profile/prefs.js" >&2 || true
      exit 0
    fi
    if grep -Fq 'user_pref("fluxion.tabTransfer.verification.error",' "$profile/prefs.js"; then break; fi
  fi
  kill -0 "$browser_pid" 2>/dev/null && kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native tab-transfer gate failed; URL recreation does not pass this check.\n' >&2
if [[ -f "$profile/prefs.js" ]]; then grep 'user_pref("fluxion.tabTransfer.verification.' "$profile/prefs.js" >&2 || true; fi
sed -n '1,180p' "$browser_log" >&2
if [[ -f "$keyboard_log" ]]; then sed -n '1,100p' "$keyboard_log" >&2; fi
exit 1
