import { describe, expect, it } from 'vitest';
import { cleanTitle, isCorrectGuess, normalize, titlePattern } from './match';

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('De Música Ligera')).toBe('de musica ligera');
  });

  it('drops parenthesized and bracketed versions', () => {
    expect(normalize('Persiana Americana (Remastered 2007) [Live]')).toBe('persiana americana');
  });

  it('drops dash suffixes like remaster notes', () => {
    expect(normalize('Bohemian Rhapsody - Remastered 2011')).toBe('bohemian rhapsody');
  });

  it('drops featuring credits', () => {
    expect(normalize('Tusa feat. Nicki Minaj')).toBe('tusa');
  });
});

describe('cleanTitle', () => {
  it('drops version notes in parentheses and after dashes', () => {
    expect(cleanTitle('Maribel Se Durmió (Album Version)')).toBe('Maribel Se Durmió');
    expect(cleanTitle('Bohemian Rhapsody - Remastered 2011')).toBe('Bohemian Rhapsody');
  });

  it('drops bare remaster suffixes Deezer puts in the title', () => {
    expect(cleanTitle('De Música Ligera Remasterizado 2007')).toBe('De Música Ligera');
    expect(cleanTitle('Wonderwall Remastered')).toBe('Wonderwall');
  });

  it('drops live/unplugged suffixes', () => {
    expect(cleanTitle('En la Ciudad de la Furia MTV Unplugged')).toBe('En la Ciudad de la Furia');
    expect(cleanTitle('Los Piratas En Vivo')).toBe('Los Piratas');
  });

  it('keeps normal titles untouched', () => {
    expect(cleanTitle('Lamento Boliviano')).toBe('Lamento Boliviano');
  });
});

describe('isCorrectGuess', () => {
  const answer = { id: 1, title: 'De Música Ligera', artist: 'Soda Stereo' };

  it('accepts the exact same track id', () => {
    expect(isCorrectGuess(answer, { id: 1, title: 'x', artist: 'y' })).toBe(true);
  });

  it('accepts another version of the same song by the same artist', () => {
    expect(
      isCorrectGuess(answer, { id: 2, title: 'De Musica Ligera (En Vivo)', artist: 'Soda Stereo' }),
    ).toBe(true);
  });

  it('accepts when the artist credit contains the answer artist', () => {
    expect(
      isCorrectGuess(answer, { id: 3, title: 'De Música Ligera', artist: 'Soda Stereo & Friends' }),
    ).toBe(true);
  });

  it('accepts a remastered version whose title carries a bare remaster suffix', () => {
    expect(
      isCorrectGuess(answer, { id: 6, title: 'De Música Ligera Remasterizado 2007', artist: 'Soda Stereo' }),
    ).toBe(true);
  });

  it('rejects a cover by another artist', () => {
    expect(isCorrectGuess(answer, { id: 4, title: 'De Música Ligera', artist: 'Juanes' })).toBe(
      false,
    );
  });

  it('rejects a different song by the same artist', () => {
    expect(isCorrectGuess(answer, { id: 5, title: 'Persiana Americana', artist: 'Soda Stereo' })).toBe(
      false,
    );
  });
});

describe('titlePattern', () => {
  it('hides letters and digits but keeps word shape', () => {
    expect(titlePattern('De Música Ligera')).toBe('__ ______ ______');
  });

  it('ignores version notes', () => {
    expect(titlePattern('Maribel Se Durmió (Album Version)')).toBe('_______ __ ______');
  });

  it('keeps punctuation visible', () => {
    expect(titlePattern("Don't Stop")).toBe("___'_ ____");
  });
});
