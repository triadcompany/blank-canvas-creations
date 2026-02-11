/**
 * Normalizes text for keyword matching:
 * - Converts to lowercase
 * - Removes diacritics/accents via Unicode NFD
 * - Trims and collapses multiple spaces into one
 * - Preserves punctuation (to avoid false positives)
 *
 * Example: "AnÚncio   !!!" => "anuncio !!!"
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches a message against a keyword using the specified match type.
 * When ignoreAccentsCase is true (default), both message and keyword are normalized.
 * For regex, normalization is only applied if explicitly requested.
 */
export function matchKeyword(
  message: string,
  keyword: string,
  matchType: string,
  ignoreAccentsCase: boolean = true,
): { matched: boolean; messageCompared: string; keywordCompared: string; normalizationApplied: boolean } {
  const isRegex = matchType === "regex";

  // For regex, use raw text by default (ignoreAccentsCase controls whether to normalize first)
  const normalizationApplied = isRegex ? ignoreAccentsCase : ignoreAccentsCase;

  const messageCompared = normalizationApplied ? normalizeText(message) : message;
  const keywordCompared = (!isRegex && normalizationApplied) ? normalizeText(keyword) : keyword;

  let matched = false;

  switch (matchType) {
    case "contains":
      matched = messageCompared.includes(keywordCompared);
      break;
    case "equals":
      matched = messageCompared === keywordCompared;
      break;
    case "starts_with":
      matched = messageCompared.startsWith(keywordCompared);
      break;
    case "regex":
      try {
        const flags = ignoreAccentsCase ? "i" : "";
        matched = new RegExp(keyword, flags).test(normalizationApplied ? messageCompared : message);
      } catch {
        matched = false;
      }
      break;
    default:
      matched = messageCompared.includes(keywordCompared);
  }

  return { matched, messageCompared, keywordCompared, normalizationApplied };
}
