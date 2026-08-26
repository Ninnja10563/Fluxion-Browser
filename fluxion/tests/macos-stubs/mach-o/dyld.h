#ifndef FLUXION_TEST_MACH_O_DYLD_H
#define FLUXION_TEST_MACH_O_DYLD_H

#include <stdint.h>

int _NSGetExecutablePath(char *buffer, uint32_t *buffer_size);

#endif
