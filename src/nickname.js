const ADJECTIVES = [
  "Regal", "Porcelain", "Majestic", "Swift", "Relieved", "Noble", "Silent", "Grand",
  "Thoughtful", "Brave", "Gentle", "Mighty", "Calm", "Ceremonial", "Dignified", "Humble",
];
const NOUNS = [
  "Plunger", "Baron", "Flusher", "Scholar", "Duke", "Sitter", "Philosopher", "Knight",
  "Countess", "Squire", "Monarch", "Student", "Wizard", "Captain", "Regent", "Pilgrim",
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable, anonymous, silly display name derived from a user id. Nothing is stored. */
export function nickname(uid) {
  const h = hash(uid);
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 8) % NOUNS.length]}`;
}
