/* Test-only, read-only AppKit helper attribution. Never authorizes a process
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

int main(int argc, char **argv) {
  char *end = NULL;
  int focused = argc == 3 && !strcmp(argv[2], "--focused");
  int authorized_only = focused || (argc == 3 && !strcmp(argv[2], "--authorized"));
  if (argc != 2 && !authorized_only) { fputs("usage: file-picker-owner OWNED_BROWSER_PID [--authorized|--focused]\n", stderr); return 64; }
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
    printf("%d\n", approved);
  } else puts("]}");
  return 0;
}
