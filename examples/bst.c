struct TreeNode {
  int key;
  struct TreeNode* left;
  struct TreeNode* right;
};

struct TreeNode* insert(struct TreeNode* root, int key) {
  if (root == 0) {
    struct TreeNode* node = malloc(sizeof(struct TreeNode));
    node->key = key;
    node->left = 0;
    node->right = 0;
    return node;
  }

  if (key < root->key) {
    root->left = insert(root->left, key);
  } else {
    root->right = insert(root->right, key);
  }
  return root;
}

bool search(struct TreeNode* root, int key) {
  if (root == 0) return false;
  if (root->key == key) return true;
  if (key < root->key) return search(root->left, key);
  return search(root->right, key);
}

int main() {
  struct TreeNode* root = 0;
  root = insert(root, 50);
  root = insert(root, 30);
  root = insert(root, 70);
  root = insert(root, 20);
  root = insert(root, 40);

  bool found40 = search(root, 40);
  bool found90 = search(root, 90);

  print_int(found40);
  print_int(found90);

  return found40 ? 1 : 0;
}
