/* Test-only AppKit helper attribution and fixed-fixture Unicode key input.
 * Attribution/focus modes are read-only. Never authorizes a process
 * based on its name alone or a shared shell/runner ancestor. The responsibility
 * SPI is intentionally dynamically resolved and fails closed when unavailable.
 * This executable is built into the verifier's temporary directory, not shipped.
 */
#include <dlfcn.h>
#include <ApplicationServices/ApplicationServices.h>
#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/stat.h>
#include <unistd.h>

typedef pid_t (*responsible_pid_fn)(pid_t);

static int focused_info(pid_t approved, pid_t owner, responsible_pid_fn responsible) {
  AXUIElementRef system = AXUIElementCreateSystemWide();
  AXUIElementSetMessagingTimeout(system, 1.0);
  CFTypeRef raw = NULL;
  AXError error = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute, &raw);
  CFRelease(system);
  printf("{\"axTrusted\":%s,\"focusError\":%d,\"authorizedHelperPID\":%d",
    AXIsProcessTrusted() ? "true" : "false", error, approved);
  if (error != kAXErrorSuccess || !raw || CFGetTypeID(raw) != AXUIElementGetTypeID()) {
    if (raw) CFRelease(raw);
    puts("}"); return 1;
  }
  AXUIElementRef node = (AXUIElementRef)raw;
  AXUIElementSetMessagingTimeout(node, 1.0);
  pid_t focused_pid = 0;
  error = AXUIElementGetPid(node, &focused_pid);
  printf(",\"focusedPID\":%d,\"pidError\":%d", focused_pid, error);
  // No names, roles, attributes or parents from an unrelated focused element.
  if (error != kAXErrorSuccess || focused_pid != approved || responsible(approved) != owner) {
    CFRelease(node); puts("}"); return 1;
  }
  printf(",\"lineage\":[");
  for (int depth = 0; depth < 12; ++depth) {
    pid_t node_pid = 0;
    if (AXUIElementGetPid(node, &node_pid) != kAXErrorSuccess || node_pid != approved || responsible(approved) != owner) break;
    CFTypeRef role = NULL;
    error = AXUIElementCopyAttributeValue(node, kAXRoleAttribute, &role);
    char role_text[96] = {0};
    if (role && CFGetTypeID(role) == CFStringGetTypeID()) CFStringGetCString((CFStringRef)role, role_text, sizeof(role_text), kCFStringEncodingUTF8);
    // AX roles are platform identifiers. Refuse unexpected JSON metacharacters.
    for (size_t i = 0; role_text[i]; ++i) if ((role_text[i] < 'A' || role_text[i] > 'Z') && (role_text[i] < 'a' || role_text[i] > 'z')) role_text[i] = '_';
    printf("%s{\"pid\":%d,\"role\":\"%s\",\"error\":%d}", depth ? "," : "", node_pid, role_text, error);
    if (role) CFRelease(role);
    CFTypeRef parent = NULL;
    error = AXUIElementCopyAttributeValue(node, kAXParentAttribute, &parent);
    if (error != kAXErrorSuccess || !parent || CFGetTypeID(parent) != AXUIElementGetTypeID()) {
      if (parent) CFRelease(parent);
      break;
    }
    CFRelease(node);
    node = (AXUIElementRef)parent;
  }
  CFRelease(node);
  puts("]}");
  return 0;
}

static int info(pid_t pid, struct proc_bsdinfo *result) {
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, result, sizeof(*result)) == (int)sizeof(*result);
}

static int same_process(const struct proc_bsdinfo *a, const struct proc_bsdinfo *b) {
  return a->pbi_pid == b->pbi_pid && a->pbi_uid == b->pbi_uid &&
    a->pbi_start_tvsec == b->pbi_start_tvsec && a->pbi_start_tvusec == b->pbi_start_tvusec;
}

static int type_fixture_path(const char *path, pid_t owner, pid_t approved,
    const struct proc_bsdinfo *owner_identity, const struct proc_bsdinfo *panel_identity,
    responsible_pid_fn responsible) {
  const char *leaf = strrchr(path, '/');
  char canonical[PATH_MAX], temporary[PATH_MAX];
  const char *temp_root = getenv("TMPDIR");
  struct stat file_info;
  if (!leaf || strcmp(leaf + 1, "Fluxion caf\xc3\xa9 upload.txt") ||
      !realpath(path, canonical) || !realpath(temp_root && *temp_root ? temp_root : "/tmp", temporary) ||
      lstat(path, &file_info) || !S_ISREG(file_info.st_mode) || file_info.st_uid != getuid() || file_info.st_size != 87) {
    fputs("Refusing a non-fixture Unicode input path\n", stderr); return 1;
  }
  size_t root_length = strlen(temporary);
  const char *prefix = "/fluxion-file-picker-check.";
  const char *suffix = canonical + root_length;
  if (strncmp(canonical, temporary, root_length) || strncmp(suffix, prefix, strlen(prefix))) {
    fputs("Unicode input path is outside the owned temporary fixture namespace\n", stderr); return 1;
  }
  suffix += strlen(prefix);
  size_t nonce = strcspn(suffix, "/");
  if (nonce != 6 || !suffix[nonce] || strchr(suffix + nonce + 1, '/')) return 1;
  for (size_t i = 0; i < nonce; ++i) {
    if ((suffix[i] < 'A' || suffix[i] > 'Z') && (suffix[i] < 'a' || suffix[i] > 'z') &&
        (suffix[i] < '0' || suffix[i] > '9')) return 1;
  }
  if (!CGPreflightPostEventAccess()) { fputs("Native keyboard event permission is unavailable\n", stderr); return 1; }
  CFStringRef text = CFStringCreateWithCString(NULL, path, kCFStringEncodingUTF8);
  if (!text) return 1;
  CFIndex length = CFStringGetLength(text);
  for (CFIndex i = 0; i < length; ++i) {
    struct proc_bsdinfo owner_now, panel_now;
    if (!info(owner, &owner_now) || !same_process(owner_identity, &owner_now) ||
        !info(approved, &panel_now) || !same_process(panel_identity, &panel_now) || responsible(approved) != owner) {
      CFRelease(text); fputs("Native keyboard target ownership changed\n", stderr); return 1;
    }
    UniChar character = CFStringGetCharacterAtIndex(text, i);
    CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
    if (!down || !up) {
      if (down) CFRelease(down);
      if (up) CFRelease(up);
      CFRelease(text); return 1;
    }
    CGEventSetFlags(down, 0);
    CGEventSetFlags(up, 0);
    CGEventKeyboardSetUnicodeString(down, 1, &character);
    CGEventKeyboardSetUnicodeString(up, 1, &character);
    // AppKit's remote panel does not receive events posted to Gecko's PID.
    // Use the normal session route, just like the driver's System Events keys.
    // The driver requires the exact owned browser to be foreground beforehand.
    CGEventPost(kCGSessionEventTap, down);
    CGEventPost(kCGSessionEventTap, up);
    CFRelease(down);
    CFRelease(up);
    usleep(5000);
  }
  CFRelease(text);
  printf("Native UTF-16 keyboard path input sent for foreground browser %d\n", owner);
  return 0;
}

int main(int argc, char **argv) {
  char *end = NULL;
  int focused = argc == 3 && !strcmp(argv[2], "--focused");
  int type_path = argc == 4 && !strcmp(argv[2], "--type-path");
  int authorized_only = focused || type_path || (argc == 3 && !strcmp(argv[2], "--authorized"));
  if (argc != 2 && !authorized_only) { fputs("usage: file-picker-owner OWNED_BROWSER_PID [--authorized|--focused|--type-path FIXTURE_PATH]\n", stderr); return 64; }
  errno = 0;
  long parsed = strtol(argv[1], &end, 10);
  if (errno || !end || *end || parsed <= 1 || parsed > INT_MAX) return 64;
  pid_t owner = (pid_t)parsed;
  responsible_pid_fn responsible = (responsible_pid_fn)dlsym(RTLD_DEFAULT, "responsibility_get_pid_responsible_for_pid");
  if (!responsible) { fputs("AppKit ownership SPI is unavailable\n", stderr); return 69; }
  struct proc_bsdinfo owner_before, owner_after;
  if (!info(owner, &owner_before) || owner_before.pbi_uid != getuid()) {
    fputs("Owned browser is absent or belongs to another user\n", stderr); return 1;
  }
  int count = proc_listallpids(NULL, 0);
  if (count <= 0 || count > 65536) return 1;
  size_t capacity = (size_t)count + 256;
  pid_t *pids = calloc(capacity, sizeof(*pids));
  if (!pids) return 1;
  count = proc_listallpids(pids, (int)(capacity * sizeof(*pids)));
  if (count <= 0 || (size_t)count >= capacity) { free(pids); return 1; }
  const char *expected = "/System/Library/Frameworks/AppKit.framework/Versions/C/XPCServices/com.apple.appkit.xpc.openAndSavePanelService.xpc/Contents/MacOS/com.apple.appkit.xpc.openAndSavePanelService";
  if (!authorized_only) printf("{\"ownedPID\":%d,\"ownerResponsiblePID\":%d,\"ownerStart\":\"%llu.%06llu\",\"candidates\":[",
    owner, responsible(owner), (unsigned long long)owner_before.pbi_start_tvsec,
    (unsigned long long)owner_before.pbi_start_tvusec);
  int emitted = 0;
  int approved_count = 0;
  pid_t approved = 0;
  struct proc_bsdinfo approved_info = {0};
  for (int i = 0; i < count; ++i) {
    char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
    if (proc_pidpath(pids[i], path, sizeof(path)) <= 0 || strcmp(path, expected)) continue;
    struct proc_bsdinfo before, after;
    if (!info(pids[i], &before) || before.pbi_uid != owner_before.pbi_uid) continue;
    pid_t attribution = responsible(pids[i]);
    if (!info(pids[i], &after) || !same_process(&before, &after)) continue;
    if (attribution == owner) { approved_count++; approved = pids[i]; approved_info = after; }
    if (!authorized_only) printf("%s{\"pid\":%d,\"responsiblePID\":%d,\"start\":\"%llu.%06llu\",\"authorized\":%s}",
      emitted++ ? "," : "", pids[i], attribution,
      (unsigned long long)before.pbi_start_tvsec, (unsigned long long)before.pbi_start_tvusec,
      attribution == owner ? "true" : "false");
  }
  free(pids);
  if (!info(owner, &owner_after) || !same_process(&owner_before, &owner_after)) {
    fputs("\nOwned browser identity changed during attribution\n", stderr); return 1;
  }
  if (authorized_only) {
    struct proc_bsdinfo approved_after;
    if (approved_count != 1 || !info(approved, &approved_after) ||
        !same_process(&approved_info, &approved_after) || responsible(approved) != owner) {
      fputs("No unique live AppKit panel service attributed to the owned browser\n", stderr); return 1;
    }
    if (focused) return focused_info(approved, owner, responsible);
    if (type_path) return type_fixture_path(argv[3], owner, approved, &owner_after, &approved_after, responsible);
    printf("%d\n", approved);
  } else puts("]}");
  return 0;
}
