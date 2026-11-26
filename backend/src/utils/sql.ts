// Builds "col = $n" fragments for the keys present in `input`.
// `columns` is a hard-coded whitelist (key -> column), values are always parameterized.
export function buildSet(columns: Record<string, string>, input: Record<string, unknown>, params: unknown[]): string[] {
  const parts: string[] = [];
  for (const [key, col] of Object.entries(columns)) {
    if (input[key] !== undefined) {
      params.push(input[key]);
      parts.push(`${col} = $${params.length}`);
    }
  }
  return parts;
}
