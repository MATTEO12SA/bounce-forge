# Bounce Forge

Bounce Forge est un brick breaker navigateur cree avec TypeScript, Vite et Phaser 3.

Cree par **Matteo_plmr**.

Le jeu est centre sur la multiplication de balles, une physique de murs propre, un style visuel jaune/forge lisible, et une campagne qui alterne niveaux ouverts, couloirs, chaines d'explosions et fins de niveau avec beaucoup de balles.

## Installation

```bash
npm install
npm start
```

Ouvre ensuite l'URL locale affichee par Vite, en general `http://localhost:5173`.

Par defaut, le jeu demarre directement au niveau 1. Ajoute `?menu=1` a l'URL pour ouvrir le menu principal en premier.

## Serveur Et Admin

Le jeu reste jouable sans compte. Le serveur admin sert uniquement a proteger les modifications officielles de campagne.

En dev, `npm start` lance Vite sur `http://localhost:5173` et l'API admin sur `http://localhost:8787`. Vite proxifie `/api` vers le serveur admin.

Pour activer le login admin :

```bash
Copy-Item .env.example .env
# puis modifie .env avec ADMIN_PASSWORD=ton-mot-de-passe
npm start
```

En production locale :

```bash
npm run build
$env:ADMIN_PASSWORD="ton-mot-de-passe"
npm run serve
```

Les niveaux modifies par l'admin sont sauvegardes dans `data/campaign-level-overrides.json` et restent actifs apres redemarrage serveur.

## Controles

- Souris ou tactile : deplacer la barre.
- Fleches ou A/D : deplacer la barre.
- Espace ou toucher l'ecran : lancer la balle attachee.
- P ou Echap : pause.
- R : recommencer le niveau actuel.

## Gameplay

Le but est de casser toutes les briques destructibles en gardant au moins une balle en jeu.

Boucle principale :

- Casser les briques pour marquer des points et monter le combo.
- Recuperer les bonus qui tombent avec la barre.
- Utiliser les bonus `x2` et `x3` pour augmenter le nombre de balles actives.
- Terminer le niveau pour debloquer le suivant.
- Gagner des medailles pour les meilleurs clears.

Le cap actuel est de `40` balles actives. Les derniers niveaux sont donc concus pour devenir tres chaotiques et satisfaisants sans depasser la limite physique.

## Campagne

La campagne contient **24 niveaux fixes** repartis en 4 chapitres :

- **Forge Basics** : layouts ouverts, debut facile, premieres briques bonus.
- **Wall Mazes** : murs proches des murs natifs, couloirs, rebonds precis.
- **Chain Reactor** : niveaux explosifs avec de gros combos possibles.
- **Ball Storm** : beaucoup de briques bonus et des niveaux faits pour atteindre 20 a 40 balles.

Les niveaux de campagne sont fixes. Sauvegarder une map dans l'editeur ne remplace pas les niveaux de campagne au rechargement ou depuis la selection de niveau.

## Briques

Les patterns de niveau utilisent ces symboles :

- `.` : case vide.
- `1` : brique standard, 1 coup.
- `2` : brique resistante.
- `3` : brique plus solide.
- `E` : brique explosive, endommage les briques destructibles proches.
- `B` : brique bonus, drop toujours un bonus de balle (`x2` ou `x3`).
- `S` : brique shield, plus solide et donne plus de score.
- `X` : mur indestructible.

L'interaction des murs `X` est volontairement proche du comportement des murs natifs, pour eviter que la balle se coince dans les jonctions ou les couloirs d'un bloc.

## Bonus

Bonus actuels :

- `x3` multi-ball : ajoute 2 clones depuis la balle source.
- `x2` split-ball : ajoute 1 clone depuis la balle source.
- `W` wide paddle : agrandit temporairement la barre.
- `+1` extra life : ajoute une vie jusqu'au cap.

Les bonus de balles sont largement majoritaires dans la distribution. `widePaddle` reste volontairement rare.

## Objectifs Et Medailles

Chaque niveau de campagne a un objectif secondaire affiche dans la bande HUD du haut, par exemple :

- Atteindre un nombre cible de balles.
- Declencher un nombre cible d'explosions.
- Terminer avec assez de vies restantes.
- Atteindre un combo cible.

Les medailles sont sauvegardees par niveau :

- **Bronze** : niveau termine.
- **Silver** : niveau termine avec le nombre de vies demande.
- **Gold** : score cible ou combo cible atteint.

Les medailles sont optionnelles et ne bloquent pas la progression.

## Mode Creatif Et Admin

Le mode creatif est separe de la progression de campagne.

Mode creatif joueur :

- Peindre des maps avec tous les symboles : `.`, `1`, `2`, `3`, `E`, `B`, `S`, `X`.
- Sauvegarder des slots creatifs en local.
- Appuyer sur `PLAY` pour jouer la map creative.
- Ne jamais modifier la campagne officielle.

Mode admin :

- Accessible uniquement depuis le bouton `ADMIN` du menu principal.
- Le mot de passe est verifie cote serveur via `/api/admin/login`.
- L'editeur admin peut modifier un niveau campagne.
- La sauvegarde admin est globale et persistante.

La selection de niveau charge toujours la campagne officielle, avec les overrides admin serveur s'ils existent. Les slots creatifs locaux ne peuvent jamais remplacer la campagne.

## Scripts

- `npm start` : demarre le serveur de dev local.
- `npm run dev` : alias de `npm start`.
- `npm run build` : verification TypeScript et build production.
- `npm run preview` : sert le build production.
- `npm run serve` : sert le build avec l'API admin Node.
- `npm run lint` : lance ESLint.
- `npm run test` : lance les tests unitaires.
- `npm run format:check` : verifie le formatage Prettier.

Diagnostics navigateur :

- `npm run test:browser` : test de jeu automatise en headless.
- `npm run test:browser:editor` : peint, sauvegarde et joue un slot editeur.
- `npm run test:browser:campaign` : verifie les 24 niveaux et la compatibilite editeur `B/S`.
- `npm run test:browser:admin` : verifie le bouton admin, le mode creatif local, l'editeur admin et le remplacement campagne.
- `npm run test:browser:ui` : capture menu, selection de niveau, editeur, gameplay, pause et victoire.
- `npm run test:browser:corridor` : verifie qu'un lancement normal peut entrer dans un couloir.
- `npm run test:browser:walls` : compare les rebonds murs natifs et murs placables.
- `npm run test:browser:powerups` : verifie les chemins de pickup des bonus.
- `npm run test:browser:powerups:diagnostic` : verifie la distribution des bonus, le clonage source-only et le cap de 40 balles.

La plupart des tests navigateur creent des captures temporaires. Elles peuvent etre supprimees apres inspection et ne sont pas necessaires au jeu.

## Sauvegarde

La sauvegarde est stockee dans le local storage du navigateur sous `bounce-forge.save.v1`.

Elle contient :

- meilleur score ;
- niveau de campagne debloque ;
- niveaux termines ;
- medaille par niveau de campagne ;
- preferences son/theme ;
- slots creatifs de l'editeur.

Le schema de sauvegarde migre automatiquement les anciennes sauvegardes.

## Structure Du Projet

- `src/game/scenes` : scenes Phaser.
- `src/game/entities` : balle, barre, briques, bonus.
- `src/game/systems` : sauvegarde, score, combo, niveaux, collisions, audio, bonus.
- `src/game/levels` : patterns de campagne, grille editeur, factory de niveaux.
- `src/game/ui` : boutons, HUD, barre de progression, chrome d'ecran partage.
- `scripts` : diagnostics navigateur et helpers locaux.
- `tests` : tests unitaires Vitest.

## Notes

- Le jeu utilise de la geometrie Phaser et des visuels proceduraux simples.
- Aucun asset graphique externe n'est requis.
- La direction visuelle actuelle est jaune/forge, parce qu'elle est plus lisible et correspond mieux au jeu que l'ancienne passe sci-fi bleue.
