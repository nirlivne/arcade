// The weighted seeded deck (G8) and bestHand() over whatever was actually collected. 4 suits (spade, heart,
// diamond, club - "a 4-colour deck" per spec), ranks 2-14 (11=J,12=Q,13=K,14=A). Pure.
import { shuffle } from "./rng.js";

export const RANKS = Array.from({ length: 13 }, (_, i) => i + 2); // 2..14
export const SUITS = [0, 1, 2, 3];

// Sums to 100. ~= pair 60%, flush 8%, royal 1-in-300 (~0.33%).
export const CLASS_WEIGHTS = [
  { key: "highCard", weight: 40 },
  { key: "pair", weight: 30 },
  { key: "twoPair", weight: 12 },
  { key: "trips", weight: 6 },
  { key: "straight", weight: 4 },
  { key: "flush", weight: 3 },
  { key: "fullHouse", weight: 2.5 },
  { key: "quads", weight: 1.5 },
  { key: "straightFlush", weight: 0.67 },
  { key: "royal", weight: 0.33 },
];

export const HAND_INFO = [
  { rank: 0, key: "highCard", name_he: "קלף גבוה", payout: 0 },
  { rank: 1, key: "pair", name_he: "זוג", payout: 200 },
  { rank: 2, key: "twoPair", name_he: "שני זוגות", payout: 400 },
  { rank: 3, key: "trips", name_he: "שלישייה", payout: 800 },
  { rank: 4, key: "straight", name_he: "סטרייט", payout: 1500 },
  { rank: 5, key: "flush", name_he: "פלאש", payout: 2000 },
  { rank: 6, key: "fullHouse", name_he: "פול האוס", payout: 3000 },
  { rank: 7, key: "quads", name_he: "רביעייה", payout: 5000 },
  { rank: 8, key: "straightFlush", name_he: "סטרייט פלאש", payout: 8000 },
  { rank: 9, key: "royal", name_he: "רויאל פלאש", payout: 20000 },
];
const HAND_BY_KEY = Object.fromEntries(HAND_INFO.map((h) => [h.key, h]));

export function rollHandClass(rng) {
  const total = CLASS_WEIGHTS.reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  for (const c of CLASS_WEIGHTS) {
    r -= c.weight;
    if (r <= 0) return c.key;
  }
  return CLASS_WEIGHTS[CLASS_WEIGHTS.length - 1].key;
}

function card(rank, suit) {
  return { rank, suit };
}
function randRank(rng) {
  return RANKS[Math.floor(rng() * RANKS.length)];
}
function randSuit(rng) {
  return SUITS[Math.floor(rng() * SUITS.length)];
}
function distinctRanks(rng, n, exclude = new Set()) {
  const out = [];
  const seen = new Set(exclude);
  while (out.length < n) {
    const r = randRank(rng);
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}
function isConsecutive(ranks) {
  const s = [...ranks].sort((a, b) => a - b);
  if (s[4] - s[0] === 4 && new Set(s).size === 5) return true;
  return s[0] === 2 && s[1] === 3 && s[2] === 4 && s[3] === 5 && s[4] === 14; // wheel
}

// Builds 5 concrete cards whose bestHand() is exactly handClass (never accidentally a stronger hand).
function buildCards(rng, handClass) {
  switch (handClass) {
    case "highCard": {
      let ranks;
      do {
        ranks = distinctRanks(rng, 5);
      } while (isConsecutive(ranks));
      let suits;
      do {
        suits = ranks.map(() => randSuit(rng));
      } while (suits.every((s) => s === suits[0]));
      return ranks.map((r, i) => card(r, suits[i]));
    }
    case "pair": {
      const [pairRank, ...kickers] = distinctRanks(rng, 4);
      const s1 = randSuit(rng);
      let s2;
      do {
        s2 = randSuit(rng);
      } while (s2 === s1);
      return [card(pairRank, s1), card(pairRank, s2), ...kickers.map((r) => card(r, randSuit(rng)))];
    }
    case "twoPair": {
      const [rankA, rankB, kicker] = distinctRanks(rng, 3);
      const suitsFor = () => {
        const s1 = randSuit(rng);
        let s2;
        do {
          s2 = randSuit(rng);
        } while (s2 === s1);
        return [s1, s2];
      };
      const [a1, a2] = suitsFor(), [b1, b2] = suitsFor();
      return [card(rankA, a1), card(rankA, a2), card(rankB, b1), card(rankB, b2), card(kicker, randSuit(rng))];
    }
    case "trips": {
      const [tripRank, ...kickers] = distinctRanks(rng, 3);
      const suits = shuffle(rng, SUITS).slice(0, 3);
      return [...suits.map((s) => card(tripRank, s)), ...kickers.map((r) => card(r, randSuit(rng)))];
    }
    case "straight":
    case "straightFlush":
    case "royal": {
      let start;
      if (handClass === "royal") {
        start = 10;
      } else {
        // starts 2..10 (wheel is start "1" conceptually: A,2,3,4,5); avoid the royal run (10) for straightFlush.
        do {
          start = 1 + Math.floor(rng() * 10); // 1..10
        } while (handClass === "straightFlush" && start === 10);
      }
      const ranks = start === 1 ? [14, 2, 3, 4, 5] : [start, start + 1, start + 2, start + 3, start + 4];
      if (handClass === "straight") {
        let suits;
        do {
          suits = ranks.map(() => randSuit(rng));
        } while (suits.every((s) => s === suits[0]));
        return ranks.map((r, i) => card(r, suits[i]));
      }
      const suit = randSuit(rng);
      return ranks.map((r) => card(r, suit));
    }
    case "flush": {
      const suit = randSuit(rng);
      let ranks;
      do {
        ranks = distinctRanks(rng, 5);
      } while (isConsecutive(ranks));
      return ranks.map((r) => card(r, suit));
    }
    case "fullHouse": {
      const [tripRank, pairRank] = distinctRanks(rng, 2);
      const tripSuits = shuffle(rng, SUITS).slice(0, 3);
      const pairSuits = shuffle(rng, SUITS).slice(0, 2);
      return [...tripSuits.map((s) => card(tripRank, s)), ...pairSuits.map((s) => card(pairRank, s))];
    }
    case "quads": {
      const [quadRank, kicker] = distinctRanks(rng, 2);
      return [...SUITS.map((s) => card(quadRank, s)), card(kicker, randSuit(rng))];
    }
    default:
      throw new Error(`unknown hand class ${handClass}`);
  }
}

// Rolls a hand class, then deals 5 concrete cards of that class, shuffled into spawn order.
export function dealHand(rng) {
  const handClass = rollHandClass(rng);
  const cards = buildCards(rng, handClass);
  return { handClass, cards: shuffle(rng, cards) };
}

// The best hand over whatever subset was actually collected (1-5 cards). A straight or flush needs all 5.
export function bestHand(cards) {
  if (!cards || cards.length === 0) return HAND_BY_KEY.highCard;
  const counts = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const countValues = Object.values(counts).sort((a, b) => b - a);

  let flush = false, straight = false, royal = false;
  if (cards.length === 5) {
    flush = cards.every((c) => c.suit === cards[0].suit);
    const ranks = [...new Set(cards.map((c) => c.rank))];
    if (ranks.length === 5) {
      straight = isConsecutive(ranks);
      const sorted = [...ranks].sort((a, b) => a - b);
      royal = flush && straight && sorted[0] === 10;
    }
  }

  let key;
  if (cards.length === 5 && flush && straight) key = royal ? "royal" : "straightFlush";
  else if (countValues[0] === 4) key = "quads";
  else if (countValues[0] === 3 && countValues[1] === 2) key = "fullHouse";
  else if (cards.length === 5 && flush) key = "flush";
  else if (cards.length === 5 && straight) key = "straight";
  else if (countValues[0] === 3) key = "trips";
  else if (countValues[0] === 2 && countValues[1] === 2) key = "twoPair";
  else if (countValues[0] === 2) key = "pair";
  else key = "highCard";

  return HAND_BY_KEY[key];
}
