#include <stdio.h>
void __attribute__((constructor)) unbuffer_stdout(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
}
