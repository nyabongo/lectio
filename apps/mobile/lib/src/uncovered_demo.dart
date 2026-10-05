/// Deliberately untested: shows the coverage gate failing (L-100 demo).
int uncoveredDemo(int value) {
  var total = 0;
  for (var i = 0; i < value; i++) {
    total += i;
  }
  if (total > 100) return total;
  if (total > 10) return total * 2;
  return -total;
}
