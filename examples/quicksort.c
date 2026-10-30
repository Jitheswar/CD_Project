void swap(int* a, int* b) {
  int t = *a;
  *a = *b;
  *b = t;
}

int partition(int* arr, int low, int high) {
  int pivot = arr[high];
  int i = low - 1;
  int j = low;

  while (j < high) {
    if (arr[j] <= pivot) {
      i = i + 1;
      swap(&arr[i], &arr[j]);
    }
    j = j + 1;
  }
  swap(&arr[i + 1], &arr[high]);
  return i + 1;
}

void quicksort(int* arr, int low, int high) {
  if (low < high) {
    int pi = partition(arr, low, high);
    quicksort(arr, low, pi - 1);
    quicksort(arr, pi + 1, high);
  }
}

int main() {
  int* arr = malloc(20);
  arr[0] = 64;
  arr[1] = 25;
  arr[2] = 12;
  arr[3] = 22;
  arr[4] = 11;

  quicksort(arr, 0, 4);

  print_int(arr[0]);
  print_int(arr[1]);
  print_int(arr[2]);
  print_int(arr[3]);
  print_int(arr[4]);

  int res = arr[4];
  free(arr);
  return res;
}
