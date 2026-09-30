import type { Difficulty, HintKey } from './game';

export type Settings = {
  rounds: number;
  difficulty: Difficulty;
  /** Theme id; '' = manual filters. */
  theme: string;
  yearFrom: number | null;
  yearTo: number | null;
  genre: string;
  country: string;
  /** 0 = no timer */
  roundSeconds: number;
};

export type Phase = 'lobby' | 'loading' | 'playing' | 'reveal' | 'finished';
export type PlayerStatus = 'waiting' | 'playing' | 'correct' | 'failed';

export type Hint = { key: HintKey; label: string; value: string };

export type PublicPlayer = {
  id: string;
  name: string;
  score: number;
  status: PlayerStatus;
  level: number;
  roundPoints: number;
  isHost: boolean;
  connected: boolean;
};

export type MyRound = {
  level: number;
  status: PlayerStatus;
  points: number;
  hints: Hint[];
  extraHintsUsed: HintKey[];
  wrongGuesses: string[];
};

export type SongReveal = {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string;
  year: number | null;
  link: string;
};

export type RoomView = {
  code: string;
  solo: boolean;
  meId: string;
  phase: Phase;
  settings: Settings;
  players: PublicPlayer[];
  roundIndex: number;
  audioUrl: string | null;
  roundEndsAt: number | null;
  me: MyRound | null;
  reveal: SongReveal | null;
  message: string | null;
};

export type SearchResult = { id: number; title: string; artist: string; cover: string };

export const GENRES = [
  { value: '', label: 'Cualquiera' },
  { value: 'rock', label: 'Rock' },
  { value: 'pop', label: 'Pop' },
  { value: 'reggaeton', label: 'Reggaetón' },
  { value: 'cumbia', label: 'Cumbia' },
  { value: 'hip hop', label: 'Hip Hop / Rap' },
  { value: 'electronica', label: 'Electrónica' },
  { value: 'metal', label: 'Metal' },
  { value: 'indie', label: 'Indie' },
  { value: 'rnb', label: 'R&B / Soul' },
  { value: 'salsa', label: 'Salsa' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'disco', label: 'Disco / Funk' },
];

export const COUNTRIES = [
  { value: '', label: 'Cualquiera' },
  { value: 'argentina', label: 'Argentina' },
  { value: 'mexico', label: 'México' },
  { value: 'espana', label: 'España' },
  { value: 'chile', label: 'Chile' },
  { value: 'colombia', label: 'Colombia' },
  { value: 'brasil', label: 'Brasil' },
  { value: 'usa', label: 'Estados Unidos' },
  { value: 'uk', label: 'Reino Unido' },
];

export const DEFAULT_SETTINGS: Settings = {
  rounds: 5,
  difficulty: 'medium',
  theme: '',
  yearFrom: null,
  yearTo: null,
  genre: '',
  country: '',
  roundSeconds: 90,
};
