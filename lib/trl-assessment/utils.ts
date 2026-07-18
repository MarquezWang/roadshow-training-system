export function uniqueStrings(values: string[], limit = 10) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    limit,
  );
}
