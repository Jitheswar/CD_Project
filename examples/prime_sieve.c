int count_primes(int n) {
  int* is_prime = malloc((n + 1) * 4);
  int i = 0;
  while (i <= n) {
    is_prime[i] = 1;
    i = i + 1;
  }
  is_prime[0] = 0;
  is_prime[1] = 0;

  int p = 2;
  while (p * p <= n) {
    if (is_prime[p] == 1) {
      int multiple = p * p;
      while (multiple <= n) {
        is_prime[multiple] = 0;
        multiple = multiple + p;
      }
    }
    p = p + 1;
  }

  int count = 0;
  i = 2;
  while (i <= n) {
    if (is_prime[i] == 1) {
      count = count + 1;
    }
    i = i + 1;
  }

  free(is_prime);
  return count;
}

int main() {
  int primesUpTo30 = count_primes(30);
  print_int(primesUpTo30); // 2, 3, 5, 7, 11, 13, 17, 19, 23, 29 -> 10 primes
  return primesUpTo30;
}
