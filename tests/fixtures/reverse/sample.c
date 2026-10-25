/*
 * InsideApp reverse-engineering sample. Compiled locally by the tests and
 * analyzed statically; it is never executed. MIT, (c) 2026 Alessandro Pezzali.
 */
#include <stdio.h>
#include <string.h>

/* Three outcomes: negative, zero, positive. */
static int classify(int value) {
  if (value < 0)
    return -1;
  if (value == 0)
    return 0;
  return 1;
}

/* Sum of the character codes, one loop over the text. */
static int checksum(const char *text) {
  int sum = 0;
  for (size_t index = 0; index < strlen(text); index++)
    sum += (unsigned char)text[index];
  return sum;
}

int main(int argc, char **argv) {
  const char *input = argc > 1 ? argv[1] : "insideapp";
  int sum = checksum(input);
  int kind = classify(sum - 900);
  printf("checksum=%d class=%d\n", sum, kind);
  return kind < 0 ? 2 : 0;
}
