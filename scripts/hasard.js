// outils/hasard.js

export function nombreAleatoire(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function choixAleatoire(liste) {
  const index = Math.floor(Math.random() * liste.length);
  return liste[index];
}

export function chance(pourcentage) {
  return Math.random() * 100 < pourcentage;
}
