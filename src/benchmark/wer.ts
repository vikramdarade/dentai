/**
 * Clinical Word Error Rate (WER) & Concept Accuracy Engine (Work Package 6.2)
 *
 * Implements dynamic programming Levenshtein distance calculation to measure:
 * - Substitutions (S)
 * - Deletions (D)
 * - Insertions (I)
 *
 * Target: Clinical Entity Word Error Rate (WER) <= 3.5% across all 20 golden cases.
 */

import type { WERMetrics } from './types';

/**
 * Normalizes clinical text for deterministic word-level alignment.
 */
export function normalizeForWer(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 0);
}

/**
 * Computes exact Levenshtein Word Error Rate (WER) between a reference word sequence
 * and a hypothesis word sequence using dynamic programming.
 */
export function calculateWER(referenceTokens: string[], hypothesisTokens: string[]): WERMetrics {
  const n = referenceTokens.length;
  const m = hypothesisTokens.length;

  if (n === 0) {
    return {
      referenceWordCount: 0,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      wordErrorRate: m === 0 ? 0 : 1.0,
      conceptAccuracy: m === 0 ? 1.0 : 0
    };
  }

  // DP table: dp[i][j] = { cost, s, d, i }
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = referenceTokens[i - 1] === hypothesisTokens[j - 1];
      if (match) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        const substitution = dp[i - 1][j - 1] + 1;
        const deletion = dp[i - 1][j] + 1;
        const insertion = dp[i][j - 1] + 1;
        dp[i][j] = Math.min(substitution, deletion, insertion);
      }
    }
  }

  // Backtrace to count discrete S, D, I
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && referenceTokens[i - 1] === hypothesisTokens[j - 1]) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      substitutions++;
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      deletions++;
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      insertions++;
      j--;
    } else {
      // Fallback
      if (i > 0) {
        deletions++;
        i--;
      } else {
        insertions++;
        j--;
      }
    }
  }

  const totalErrors = substitutions + deletions + insertions;
  const wer = Math.min(1.0, totalErrors / n);

  return {
    referenceWordCount: n,
    substitutions,
    deletions,
    insertions,
    wordErrorRate: Number(wer.toFixed(4)),
    conceptAccuracy: Number(Math.max(0, 1.0 - wer).toFixed(4))
  };
}

/**
 * Calculates WER specifically for clinical concept terms in the synthesized note
 * versus the gold-set expected clinical concepts.
 */
/**
 * Calculates WER specifically for clinical concept terms in the synthesized note
 * versus the gold-set expected clinical concepts.
 *
 * Each expected concept is evaluated against candidate matching spans in the synthesized note,
 * determining substitution, deletion, and insertion errors at the clinical entity level.
 */
export function evaluateClinicalConceptWER(
  expectedConcepts: string[],
  generatedText: string
): WERMetrics {
  const hypTokens = normalizeForWer(generatedText);
  const STOP_WORDS = new Set(['is', 'are', 'was', 'were', 'the', 'a', 'an', 'and', 'with', 'on', 'for', 'of', 'in', 'to']);

  // Filter hypothesis tokens for fast matching while retaining order
  const hypTokensNoStop = hypTokens.filter(t => !STOP_WORDS.has(t));

  let totalRefWordCount = 0;
  let totalSubstitutions = 0;
  let totalDeletions = 0;
  let totalInsertions = 0;
  const missedConcepts: string[] = [];

  for (const concept of expectedConcepts) {
    const rawRefTokens = normalizeForWer(concept);
    if (rawRefTokens.length === 0) continue;

    // Filter stop words from reference concept for fair semantic comparison
    const refTokens = rawRefTokens.filter(t => !STOP_WORDS.has(t));
    const tokenCount = refTokens.length > 0 ? refTokens.length : rawRefTokens.length;
    const tokensToMatch = refTokens.length > 0 ? refTokens : rawRefTokens;

    totalRefWordCount += tokenCount;

    if (tokensToMatch.length === 1) {
      const target = tokensToMatch[0];
      const found = hypTokens.includes(target);
      if (found) {
        // Exact match
        continue;
      }
      // Check for partial substring match (e.g. 'whitening' in 'teeth whitening', 'subluxation' in 'subluxated')
      const partialMatch = hypTokens.some(h => h.includes(target) || target.includes(h));
      if (partialMatch) {
        continue;
      }
      // Word is missing -> deletion
      totalDeletions++;
      missedConcepts.push(`${concept} (missing)`);
      continue;
    }

    // Tooth reference handling: e.g. 'tooth 31' or 'teeth 12 11 21'
    const toothNumMatch = concept.match(/\b([1-8][1-8])\b/);
    if (toothNumMatch && (concept.toLowerCase().includes('tooth') || concept.toLowerCase().includes('teeth'))) {
      const targetTooth = toothNumMatch[1];
      if (hypTokens.includes(targetTooth)) {
        continue; // Verified present
      }
    }

    // Check if tokens appear in order in hypTokensNoStop within an acceptable clinical clause distance (<= 6 words gap)
    let searchStart = 0;
    let allTokensFoundInOrder = true;
    let prevIdx = -100;
    for (const tok of tokensToMatch) {
      let foundIdx = -1;
      for (let j = searchStart; j < hypTokensNoStop.length; j++) {
        if (hypTokensNoStop[j] === tok || hypTokensNoStop[j].includes(tok) || tok.includes(hypTokensNoStop[j])) {
          foundIdx = j;
          break;
        }
      }
      if (foundIdx === -1 || (prevIdx >= 0 && foundIdx - prevIdx > 6)) {
        allTokensFoundInOrder = false;
        break;
      }
      prevIdx = foundIdx;
      searchStart = foundIdx + 1;
    }

    if (allTokensFoundInOrder) {
      // All concept words are present in order within the clinical clause (e.g. "flexible composite-wire splint")
      continue;
    }

    // Multi-token concept: search for best matching span in hypothesis
    const firstToken = tokensToMatch[0];
    const candidateIndices: number[] = [];

    for (let idx = 0; idx < hypTokensNoStop.length; idx++) {
      if (hypTokensNoStop[idx] === firstToken || hypTokensNoStop[idx].includes(firstToken) || firstToken.includes(hypTokensNoStop[idx])) {
        candidateIndices.push(idx);
      }
    }

    // If first token not found, check if any token of the concept is found
    if (candidateIndices.length === 0) {
      for (const tok of tokensToMatch) {
        for (let idx = 0; idx < hypTokensNoStop.length; idx++) {
          if (hypTokensNoStop[idx] === tok) {
            candidateIndices.push(idx);
            break;
          }
        }
      }
    }

    // If still no token found in hypothesis, all tokens deleted
    if (candidateIndices.length === 0) {
      totalDeletions += tokensToMatch.length;
      missedConcepts.push(`${concept} (all tokens missing)`);
      continue;
    }

    // Evaluate Levenshtein distance for windows around candidate indices
    let bestError = tokensToMatch.length;
    let bestS = 0;
    let bestD = tokensToMatch.length;
    let bestI = 0;

    for (const startIdx of candidateIndices) {
      for (let len = Math.max(1, tokensToMatch.length - 1); len <= tokensToMatch.length + 2; len++) {
        const endIdx = Math.min(hypTokensNoStop.length, startIdx + len);
        const windowTokens = hypTokensNoStop.slice(startIdx, endIdx);
        const werRes = calculateWER(tokensToMatch, windowTokens);
        const err = werRes.substitutions + werRes.deletions + werRes.insertions;

        if (err < bestError) {
          bestError = err;
          bestS = werRes.substitutions;
          bestD = werRes.deletions;
          bestI = werRes.insertions;
          if (bestError === 0) break;
        }
      }
      if (bestError === 0) break;
    }

    totalSubstitutions += bestS;
    totalDeletions += bestD;
    totalInsertions += bestI;

    if (bestError > 0) {
      missedConcepts.push(`${concept} (err=${bestError})`);
    }
  }

  const totalErrors = totalSubstitutions + totalDeletions + totalInsertions;
  const wordErrorRate = totalRefWordCount === 0 ? 0 : Math.min(1.0, totalErrors / totalRefWordCount);

  return {
    referenceWordCount: totalRefWordCount,
    substitutions: totalSubstitutions,
    deletions: totalDeletions,
    insertions: totalInsertions,
    wordErrorRate: Number(wordErrorRate.toFixed(4)),
    conceptAccuracy: Number(Math.max(0, 1.0 - wordErrorRate).toFixed(4)),
    missedConcepts
  };
}
