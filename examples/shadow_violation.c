int main() {
  int* arr = malloc(20); // 5 elements [0..4]
  arr[0] = 10;
  arr[1] = 20;
  arr[2] = 30;
  arr[3] = 40;
  arr[4] = 50;

  // Deliberate out-of-bounds write
  // Shadow memory will catch this immediately!
  arr[5] = 999;

  print_int(arr[0]);
  free(arr);
  return 0;
}
