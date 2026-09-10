/* Test-only, read-only AppKit helper attribution. Never authorizes a process
 * based on its name alone or a shared shell/runner ancestor. The responsibility
 * SPI is intentionally dynamically resolved and fails closed when unavailable.
 * This executable is built into the verifier's temporary directory, not shipped.
 */
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <unistd.h>

typedef pid_t (*responsible_pid_fn)(pid_t);

static int info(pid_t pid, struct proc_bsdinfo *result) {
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, result, sizeof(*result)) == (int)sizeof(*result);
}

static int same_process(const struct proc_bsdinfo *a, const struct proc_bsdinfo *b) {
  return a->pbi_pid == b->pbi_pid && a->pbi_uid == b->pbi_uid &&
    a->pbi_start_tvsec == b->pbi_start_tvsec && a->pbi_start_tvusec == b->pbi_start_tvusec;
}

int main(int argc, char **argv) {
  char *end = NULL;
  if (argc != 2) { fputs("usage: file-picker-owner OWNED_BROWSER_PID\n", stderr); return 64; }
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
  printf("{\"ownedPID\":%d,\"ownerResponsiblePID\":%d,\"ownerStart\":\"%llu.%06llu\",\"candidates\":[",
    owner, responsible(owner), (unsigned long long)owner_before.pbi_start_tvsec,
    (unsigned long long)owner_before.pbi_start_tvusec);
  int emitted = 0;
  for (int i = 0; i < count; ++i) {
    char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
    if (proc_pidpath(pids[i], path, sizeof(path)) <= 0 || strcmp(path, expected)) continue;
    struct proc_bsdinfo before, after;
    if (!info(pids[i], &before) || before.pbi_uid != owner_before.pbi_uid) continue;
    pid_t attribution = responsible(pids[i]);
    if (!info(pids[i], &after) || !same_process(&before, &after)) continue;
    printf("%s{\"pid\":%d,\"responsiblePID\":%d,\"start\":\"%llu.%06llu\",\"authorized\":%s}",
      emitted++ ? "," : "", pids[i], attribution,
      (unsigned long long)before.pbi_start_tvsec, (unsigned long long)before.pbi_start_tvusec,
      attribution == owner ? "true" : "false");
  }
  free(pids);
  if (!info(owner, &owner_after) || !same_process(&owner_before, &owner_after)) {
    fputs("\nOwned browser identity changed during attribution\n", stderr); return 1;
  }
  puts("]}");
  return 0;
}
