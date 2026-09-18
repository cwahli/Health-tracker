/**
 * Utility for parsing, formatting, and synchronizing bracket portion tags:
 * Pattern A: [Item Name] [150g] or [Item Name] [1.5x]
 * Pattern B: [Item Name 150g] or [Item Name 1.5x]
 */

export interface ParsedBracketScaling {
  raw: string;
  value: number;
  unit: 'g' | 'x' | 'serving';
}

export interface ParsedBracketItem {
  rawMatch: string;
  name: string;
  scaling?: ParsedBracketScaling;
}

export function parseScalingString(scalingStr: string): ParsedBracketScaling | undefined {
  if (!scalingStr) return undefined;
  const trimmed = scalingStr.trim();

  // Multiplier pattern: 1.5x, 2x, 0.5X
  const multiplierMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*x$/i);
  if (multiplierMatch) {
    return {
      raw: trimmed,
      value: parseFloat(multiplierMatch[1]),
      unit: 'x'
    };
  }

  // Servings pattern: 2 servings, 1 serving
  const servingMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*servings?$/i);
  if (servingMatch) {
    return {
      raw: trimmed,
      value: parseFloat(servingMatch[1]),
      unit: 'serving'
    };
  }

  // Grams pattern: 150g, 200 g
  const gramMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*g$/i);
  if (gramMatch) {
    return {
      raw: trimmed,
      value: parseFloat(gramMatch[1]),
      unit: 'g'
    };
  }

  // Raw number (defaults to grams)
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    return {
      raw: `${numMatch[1]}g`,
      value: parseFloat(numMatch[1]),
      unit: 'g'
    };
  }

  return undefined;
}

/**
 * Parses all bracketed food tags from text.
 * Handles both:
 * 1) [Item Name] [150g]
 * 2) [Item Name 150g]
 */
export function parseBracketItems(text: string): ParsedBracketItem[] {
  if (!text) return [];

  const results: ParsedBracketItem[] = [];
  // Regex matches [content1] optionally followed by whitespace and [content2]
  const regex = /\[([^\]]+)\](?:\s*\[([^\]]+)\])?/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const firstContent = (match[1] || '').trim();
    const secondContent = (match[2] || '').trim();

    if (!firstContent) continue;

    // Check if second bracket is a scaling indicator, e.g. [Item Name] [150g]
    const secondScaling = secondContent ? parseScalingString(secondContent) : undefined;
    if (secondScaling) {
      results.push({
        rawMatch: match[0],
        name: firstContent,
        scaling: secondScaling
      });
      continue;
    }

    // Check if first bracket contains inline scaling at the end, e.g. [Item Name 150g] or [Item Name 1.5x]
    const inlineMatch = firstContent.match(/^(.*?)\s+(\d+(?:\.\d+)?(?:g|x|servings?))$/i);
    if (inlineMatch) {
      const parsedScaling = parseScalingString(inlineMatch[2]);
      if (parsedScaling) {
        results.push({
          rawMatch: match[0],
          name: inlineMatch[1].trim(),
          scaling: parsedScaling
        });
        continue;
      }
    }

    // If secondContent existed but wasn't scaling, check if firstContent was item and second was something else
    results.push({
      rawMatch: `[${firstContent}]`,
      name: firstContent
    });
    // Rewind regex if secondContent wasn't scaling so it can be parsed as its own item if applicable
    if (secondContent) {
      regex.lastIndex = match.index + firstContent.length + 2;
    }
  }

  return results;
}

/**
 * Formats a bracket item into [Name] [Scaling]
 */
export function formatBracketItem(name: string, scaling?: ParsedBracketScaling | string | number): string {
  const cleanName = name.replace(/[\[\]]/g, '').trim();
  if (!scaling) return `[${cleanName}]`;

  let scalingText = '';
  if (typeof scaling === 'number') {
    scalingText = `${scaling}g`;
  } else if (typeof scaling === 'string') {
    const parsed = parseScalingString(scaling);
    scalingText = parsed ? (parsed.unit === 'x' ? `${parsed.value}x` : parsed.unit === 'serving' ? `${parsed.value} serving` : `${parsed.value}g`) : scaling;
  } else {
    scalingText = scaling.unit === 'x' ? `${scaling.value}x` : scaling.unit === 'serving' ? `${scaling.value} serving` : `${scaling.value}g`;
  }

  return `[${cleanName}] [${scalingText}]`;
}

/**
 * Updates or appends a bracket item in the chat input text.
 */
export function updateOrAddBracketItem(
  currentText: string,
  name: string,
  scaling?: ParsedBracketScaling | string | number
): string {
  const cleanName = name.replace(/[\[\]]/g, '').trim();
  const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const formatted = formatBracketItem(cleanName, scaling);

  // Regex to match existing tag for this name (with or without scaling bracket)
  const existingRegex = new RegExp(
    `\\[+${escapedName}\\]+(?:\\s*\\[+[^\\]]+\\]+)?|\\[+${escapedName}\\s+\\d+(?:\\.\\d+)?(?:g|x|servings?)\\]+`,
    'i'
  );

  if (existingRegex.test(currentText)) {
    return currentText.replace(existingRegex, formatted);
  }

  const trimmed = currentText.trim();
  return trimmed ? `${trimmed} ${formatted}` : formatted;
}

/**
 * Removes a bracket item and any attached scaling bracket from text.
 */
export function removeBracketItem(currentText: string, name: string): string {
  const cleanName = name.replace(/[\[\]]/g, '').trim();
  const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const existingRegex = new RegExp(
    `\\s*\\[+${escapedName}\\]+(?:\\s*\\[+[^\\]]+\\]+)?|\\s*\\[+${escapedName}\\s+\\d+(?:\\.\\d+)?(?:g|x|servings?)\\]+`,
    'gi'
  );

  return currentText.replace(existingRegex, '').trim();
}

/**
 * Strips bracketed food tags from chat input text to isolate active search terms for autocomplete.
 * Returns empty string if the remaining query is shorter than 3 characters.
 */
export function extractAutocompleteQuery(text: string): string {
  if (!text) return '';
  let strippedInput = text.replace(/\[[^\]]*\]/g, '').trim();
  // Strip conversational lead words like "i had", "ate", "for lunch", "and"
  strippedInput = strippedInput.replace(/^(?:i\s+(?:had|ate|have)|had|ate|having|eating|for\s+(?:breakfast|lunch|dinner|snack)|and|plus|\+)\s+/i, '').trim();
  if (strippedInput.length < 3) return '';
  const words = strippedInput.split(/\s+/);
  return words.slice(Math.max(words.length - 4, 0)).join(' ');
}



/**
 * Clears search-term residue from the composer after a match is staged (T-5).
 * Returns '' only when the text holds nothing but the active search terms
 * (exact match, case-insensitive) — genuine questions are left untouched.
 */
export function stripSearchResidue(text: string, searchTerms: string): string {
  const t = (text || '').trim();
  const q = (searchTerms || '').trim().toLowerCase();
  if (!t || !q) return text;
  if (t.toLowerCase() === q) return '';
  return text;
}
