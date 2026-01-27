# Open Gate Viewer ☢️

Une application web interactive pour concevoir, visualiser et simuler des scènes de radiothérapie compatibles avec **GATE** (Geant4 Application for Tomographic Emission).

🔗 **[Accéder à l'application en ligne](https://qmisslin.github.io/open-gate-viewer/)**

## ✨ Fonctionnalités

- **Visualisation 3D** : Scène interactive basée sur Three.js.
- **Gestion de Sources** : Ajout paramétrique de sources radioactives (rayon, dose, atténuation).
- **Import d'Assets** : Chargement de fichiers `.stl` (Fantômes, Tables, Détecteurs).
- **Champs Voxels** : Import, visualisation et seuillage de fichiers de dose `.mhd` + `.raw`.
- **Sauvegarde de Projet** : Export complet de la scène en JSON pour reprise ultérieure.
- **Export GATE** : Génération automatique des fichiers de simulation (`.mhd`/`.raw`) prêts pour GATE.

## 🚀 Utilisation

Aucune installation n'est nécessaire. L'application tourne entièrement dans le navigateur (Client-side).

1. Ouvrez l'application.
2. Ajoutez des sources ou importez vos modèles STL.
3. Configurez la grille de voxels.
4. Cliquez sur **Export GATE** pour récupérer les fichiers.

## 🛠️ Stack Technique

- **Moteur 3D** : [Three.js](https://threejs.org/)
- **Interface** : [Lil-gui](https://lil-gui.georgealways.com/)
- **Langage** : Javascript (ES6 Modules)

## 📄 Licence

Ce projet est distribué sous licence **MIT**. Vous êtes libre de l'utiliser, le modifier et le distribuer gratuitement.

