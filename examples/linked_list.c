struct Node {
  int value;
  struct Node* next;
};

int main() {
  struct Node* head = malloc(sizeof(struct Node));
  head->value = 10;
  head->next = malloc(sizeof(struct Node));
  head->next->value = 20;
  head->next->next = 0;

  print_int(head->value);
  print_int(head->next->value);

  free(head->next);
  free(head);
  return 30;
}
