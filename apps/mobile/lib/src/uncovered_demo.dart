/// Deliberately untested: shows the coverage gate failing (L-100 demo).
int uncoveredDemo(int value) {
  if (value > 0) return value * 2;
  return -value;
}
