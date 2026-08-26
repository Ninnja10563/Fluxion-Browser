#include <mach-o/dyld.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int make_directories(const char *path) {
  char copy[PATH_MAX];
  size_t length = strnlen(path, sizeof(copy));
  if (length == 0 || length >= sizeof(copy)) return -1;
  memcpy(copy, path, length + 1);

  for (char *cursor = copy + 1; *cursor; cursor++) {
    if (*cursor != '/') continue;
    *cursor = '\0';
    if (mkdir(copy, 0700) != 0 && errno != EEXIST) return -1;
    *cursor = '/';
  }
  return mkdir(copy, 0700) == 0 || errno == EEXIST ? 0 : -1;
}

int main(int argc, char **argv) {
  char executable[PATH_MAX];
  uint32_t executable_size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &executable_size) != 0) {
    fprintf(stderr, "Fluxion could not resolve its application path.\n");
    return 69;
  }

  char resolved[PATH_MAX];
  if (!realpath(executable, resolved)) {
    perror("Fluxion realpath");
    return 69;
  }

  const char suffix[] = "/Contents/MacOS/Fluxion";
  size_t resolved_length = strlen(resolved);
  size_t suffix_length = sizeof(suffix) - 1;
  if (resolved_length <= suffix_length ||
      strcmp(resolved + resolved_length - suffix_length, suffix) != 0) {
    fprintf(stderr, "Fluxion must run from its application bundle.\n");
    return 69;
  }
  resolved[resolved_length - suffix_length] = '\0';

  char root[PATH_MAX];
  char firefox[PATH_MAX];
  if (snprintf(root, sizeof(root), "%s/Contents/Resources/fluxion", resolved) >=
          (int)sizeof(root) ||
      snprintf(firefox, sizeof(firefox), "%s/Contents/MacOS/firefox", resolved) >=
          (int)sizeof(firefox)) {
    fprintf(stderr, "Fluxion application path is too long.\n");
    return 69;
  }

  const char *profile = getenv("FLUXION_PROFILE");
  char default_profile[PATH_MAX];
  if (!profile || !*profile) {
    const char *user_home = getenv("HOME");
    if (!user_home ||
        snprintf(default_profile, sizeof(default_profile),
                 "%s/Library/Application Support/Fluxion/Profiles/default",
                 user_home) >= (int)sizeof(default_profile)) {
      fprintf(stderr, "Fluxion could not determine its profile directory.\n");
      return 69;
    }
    profile = default_profile;
  }

  if (make_directories(profile) != 0) {
    perror("Fluxion profile");
    return 73;
  }
  if (setenv("FLUXION_ROOT", root, 1) != 0) {
    perror("Fluxion environment");
    return 69;
  }

  char **child_arguments = calloc((size_t)argc + 4, sizeof(char *));
  if (!child_arguments) return 71;
  child_arguments[0] = firefox;
  child_arguments[1] = "--no-remote";
  child_arguments[2] = "--profile";
  child_arguments[3] = (char *)profile;
  for (int index = 1; index < argc; index++) {
    child_arguments[index + 3] = argv[index];
  }
  child_arguments[argc + 3] = NULL;

  execv(firefox, child_arguments);
  perror("Fluxion Firefox runtime");
  free(child_arguments);
  return 69;
}
