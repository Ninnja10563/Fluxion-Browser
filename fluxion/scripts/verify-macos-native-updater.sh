#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin && "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == macOS ]] || {
  printf 'Native replacement verification is restricted to an ephemeral macOS CI runner.\n' >&2; exit 69;
}
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_input="${1:-$fluxion_root/../.runtime/Fluxion.app}"
source_app="$(CDPATH= cd -- "$source_input" && pwd -P)"
sparkle_cache="$fluxion_root/../.runtime/sparkle-2.10.0/current"
[[ -x "$source_app/Contents/MacOS/Fluxion" && -x "$sparkle_cache/bin/sign_update" ]] || {
  printf 'Packaged Fluxion and locked Sparkle signing tool are required.\n' >&2; exit 69;
}
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-updater-check.XXXXXX")"
check_root="$(CDPATH= cd -- "$check_root" && pwd -P)"
artifact_dir="${FLUXION_NATIVE_UPDATER_ARTIFACT_DIR:-$check_root/evidence}"
app="$check_root/live/Fluxion.app"
profile=""
server_pid=""
opener_pid=""
owned_pids() {
  [[ -n "$profile" ]] || return 0
  ps -axww -o pid= -o command= | node -e '
    let text="";process.stdin.on("data",v=>text+=v);process.stdin.on("end",()=>{
      const prefix=process.argv[1]+"/Contents/MacOS/firefox --profile "+process.argv[2];
      for(const line of text.split("\n")){const row=line.match(/^\s*(\d+)\s+(.*)$/);
        if(row&&(row[2]===prefix||row[2].startsWith(prefix+" ")))console.log(row[1]);}
    });' "$app" "$profile"
}
cleanup() {
  local result=$?
  mkdir -p "$artifact_dir"
  for filename in browser.log browser-error.log browser-report.json network.json server.log; do
    [[ ! -f "$check_root/$filename" ]] || cp "$check_root/$filename" "$artifact_dir/$filename"
  done
  if [[ "$result" != 0 ]]; then /usr/sbin/screencapture -x "$artifact_dir/failure.png" || true; fi
  for pid in $(owned_pids); do
    kill "$pid" 2>/dev/null || true
    for ((attempt=0; attempt<60; attempt++)); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$pid" 2>/dev/null && owned_pids | grep -Fxq "$pid"; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
  [[ -z "$opener_pid" ]] || wait "$opener_pid" 2>/dev/null || true
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  if [[ -f "$check_root/gate.json" ]]; then
    node "$fluxion_root/scripts/updater-fixture.mjs" release "$check_root" || {
      printf 'Owned default-profile cleanup refused; fixture retained at %s\n' "$check_root" >&2; return;
    }
  fi
  # Keys and executables stay out of artifacts. This exact mktemp directory is
  # ours; keep it only if its evidence output deliberately lives inside it.
  if [[ "$artifact_dir" != "$check_root/"* ]]; then
    case "$check_root" in */fluxion-updater-check.??????) rm -rf -- "$check_root";; esac
  fi
}
trap cleanup EXIT
node "$fluxion_root/scripts/updater-fixture.mjs" claim "$check_root"
profile="$(node -p 'require(process.argv[1]).profile' "$check_root/gate.json")"
mkdir -p "$check_root/live" "$check_root/payload"
ditto "$source_app" "$app"
public_key="$(<"$check_root/public-key.txt")"
/usr/bin/xcrun clang -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 -fobjc-arc -fvisibility=hidden \
  -dynamiclib -O2 -Wall -Wextra -Wno-unused-parameter -Werror \
  -DFLUXION_UPDATER_TESTING=1 "-DFLUXION_UPDATER_TEST_PUBLIC_KEY=\"$public_key\"" \
  -F "$app/Contents/Frameworks" -framework AppKit -framework Sparkle -Wl,-rpath,@loader_path \
  "$fluxion_root/packaging/macos/updater/FluxionUpdaterBridge.m" \
  -o "$app/Contents/Frameworks/libFluxionUpdater.dylib"
codesign --force --sign - "$app/Contents/Frameworks/libFluxionUpdater.dylib"
node "$fluxion_root/scripts/updater-fixture.mjs" install-gate "$check_root"
python3 - "$app" "$public_key" <<'PY'
import json,plistlib,sys
from pathlib import Path
app=Path(sys.argv[1]); info=app/'Contents/Info.plist'
with info.open('rb') as source: p=plistlib.load(source)
p.update(CFBundleVersion='1.0.0b1',CFBundleShortVersionString='1.0.0',
 SUFeedURL='http://127.0.0.1:38473/feed/appcast.xml',SUPublicEDKey=sys.argv[2],
 SURequireSignedFeed=True,SUVerifyUpdateBeforeExtraction=True,
 SUSignedFeedFailureExpirationInterval=0,SUEnableAutomaticChecks=False,SUAutomaticallyUpdate=False)
with info.open('wb') as target: plistlib.dump(p,target)
with (app/'Contents/Resources/fluxion/runtime/updater-payload-marker.json').open('x') as target:
 json.dump({'version':'1.0.0b1'},target)
PY
codesign --force --sign - --preserve-metadata=entitlements,requirements,flags "$app"
codesign --verify --deep --strict "$app"
ditto "$app" "$check_root/payload/Fluxion.app"
python3 - "$check_root/payload/Fluxion.app" <<'PY'
import json,plistlib,sys
from pathlib import Path
app=Path(sys.argv[1]); info=app/'Contents/Info.plist'
with info.open('rb') as source: p=plistlib.load(source)
p.update(CFBundleVersion='1.0.1b1',CFBundleShortVersionString='1.0.1')
with info.open('wb') as target: plistlib.dump(p,target)
with (app/'Contents/Resources/fluxion/runtime/updater-payload-marker.json').open('w') as target:
 json.dump({'version':'1.0.1b1'},target)
PY
codesign --force --sign - --preserve-metadata=entitlements,requirements,flags "$check_root/payload/Fluxion.app"
codesign --verify --deep --strict "$check_root/payload/Fluxion.app"
ditto -c -k --sequesterRsrc --keepParent "$check_root/payload/Fluxion.app" "$check_root/payload.zip"
node "$fluxion_root/scripts/updater-fixture.mjs" feeds "$check_root" "$sparkle_cache/bin/sign_update"
rm -f -- "$check_root/signing.key" "$check_root/wrong.key"
node "$fluxion_root/scripts/updater-fixture.mjs" serve "$check_root" > "$check_root/server.log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  [[ ! -f "$check_root/server.ready" ]] || break
  kill -0 "$server_pid" 2>/dev/null || { printf 'Fixed loopback updater fixture could not bind.\n' >&2; exit 1; }
  sleep 0.25
done
[[ -f "$check_root/server.ready" ]] || exit 1
# Do not pass FLUXION_PROFILE: replacement relaunch must use the exact same
# canonical default profile through the production launcher.
env -u FLUXION_PROFILE -u GH_TOKEN -u GITHUB_TOKEN /usr/bin/open -n -W -a "$app" \
  --stdout "$check_root/browser.log" --stderr "$check_root/browser-error.log" &
opener_pid=$!
for ((attempt=0; attempt<2400; attempt++)); do
  if [[ -f "$check_root/browser-report.json" ]]; then
    status="$(node -e 'try{const r=require(process.argv[1]);console.log(r.error?"error":r.health||"pending")}catch{}' "$check_root/browser-report.json")"
    [[ "$status" != error ]] || { sed -n '1,200p' "$check_root/browser-report.json" >&2; exit 1; }
    if [[ "$status" == native-sparkle-install-and-preservation-verified ]]; then
      [[ "$(plutil -extract CFBundleVersion raw "$app/Contents/Info.plist")" == 1.0.1b1 ]]
      codesign --verify --deep --strict "$app"
      node --input-type=module - "$check_root" <<'JS'
import fs from 'node:fs';
const root=process.argv[2], report=JSON.parse(fs.readFileSync(root+'/browser-report.json'));
const network=JSON.parse(fs.readFileSync(root+'/network.json'));
if(report.cancelledQuitCount!==1||report.initialPID===report.relaunchedPID||report.installedVersion!=='1.0.1b1')throw Error('Native quit/relaunch identity proof missing');
for(const stage of ['wrong-sign','corrupt','valid']) {
 for(const path of ['/feed/appcast.xml','/releases/'+stage+'.zip']) {
  if(!network.some(row=>row.stage===stage&&row.path===path&&row.method==='GET'&&row.completed))throw Error('Missing actual '+stage+' network transfer');
 }
}
console.log(JSON.stringify(report));
JS
      printf 'Verified actual Sparkle replacement/relaunch, refused invalid archives, and cancellable native Quit.\n'
      exit 0
    fi
  fi
  kill -0 "$server_pid" 2>/dev/null || exit 1
  sleep 0.25
done
printf 'Native updater integration did not complete; no simulated installation fallback.\n' >&2
[[ ! -f "$check_root/browser-report.json" ]] || sed -n '1,200p' "$check_root/browser-report.json" >&2
exit 1
