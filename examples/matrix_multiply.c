int main() {
  int* A = malloc(16); // 2x2 matrix
  int* B = malloc(16); // 2x2 matrix
  int* C = malloc(16); // 2x2 matrix

  // A = [[1, 2], [3, 4]]
  A[0] = 1; A[1] = 2;
  A[2] = 3; A[3] = 4;

  // B = [[5, 6], [7, 8]]
  B[0] = 5; B[1] = 6;
  B[2] = 7; B[3] = 8;

  // C = A * B
  // C[0][0] = 1*5 + 2*7 = 19
  // C[0][1] = 1*6 + 2*8 = 22
  // C[1][0] = 3*5 + 4*7 = 43
  // C[1][1] = 3*6 + 4*8 = 50
  C[0] = A[0] * B[0] + A[1] * B[2];
  C[1] = A[0] * B[1] + A[1] * B[3];
  C[2] = A[2] * B[0] + A[3] * B[2];
  C[3] = A[2] * B[1] + A[3] * B[3];

  print_int(C[0]);
  print_int(C[1]);
  print_int(C[2]);
  print_int(C[3]);

  int sum = C[0] + C[1] + C[2] + C[3];
  free(A);
  free(B);
  free(C);
  return sum;
}
