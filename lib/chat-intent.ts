export function wantsRescore(text: string) {
  return /\b(re-?score|run scoring|score (the )?(list|homes|set)|grade (the )?(list|cache)|re-?grade)\b/i.test(
    text
  );
}
