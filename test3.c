#include <stdio.h>
int main(){ printf("Enter: "); fflush(stdout); char buf[50]; scanf("%49s", buf); printf("Got %s
", buf); return 0; }