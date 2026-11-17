/**
 * Défilement des chiffres pendant les lancers : UNE seule boucle pour toutes les cartes,
 * à environ 12 images par seconde, arrêtée dès qu'il n'y a plus rien à faire tourner.
 */
const actifs = new Set();
let boucle = null;
let dernier = 0;

function tick(t) {
  if (!actifs.size) { boucle = null; return; }
  if (t - dernier > 80) {
    dernier = t;
    for (const el of actifs) {
      if (!el.isConnected) { actifs.delete(el); continue; }
      el.textContent = String(Math.ceil(Math.random() * 100)).padStart(2, "0");
    }
  }
  boucle = requestAnimationFrame(tick);
}

export function tourner(el) {
  actifs.add(el);
  boucle ??= requestAnimationFrame(tick);
}

export function arreter(el) {
  actifs.delete(el);
}
