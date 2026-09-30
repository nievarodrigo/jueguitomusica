export type TrackRef = { id: number; title: string; artist: string };

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s-\s.*$/, ' ')
    .replace(/\b(feat|ft|featuring)\b\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Song title without version notes: "(Album Version)", "- Remastered 2011", "Remasterizado 2007". */
export function cleanTitle(title: string): string {
  const cleaned = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s-\s.*$/, ' ')
    .replace(/\s(remaster(ed|izad[oa])?|en vivo|live|(mtv )?unplugged)(\s\d{4})?\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title.trim();
}

export function isCorrectGuess(answer: TrackRef, guess: TrackRef): boolean {
  if (answer.id === guess.id) return true;
  if (normalize(cleanTitle(answer.title)) !== normalize(cleanTitle(guess.title))) return false;
  const a = normalize(answer.artist);
  const g = normalize(guess.artist);
  return a === g || g.includes(a) || a.includes(g);
}

/** "De Música Ligera" -> "__ ______ ______" */
export function titlePattern(title: string): string {
  return cleanTitle(title).replace(/[\p{L}\p{N}]/gu, '_');
}
