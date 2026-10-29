# EPM — Europa-Park Minecraft

Site vitrine multilingue réalisé avec Node.js, React pour le rendu serveur des icônes et Lucide React. Il affiche uniquement les informations confirmées dans les fichiers de contenu; les zones, l’équipe et les actualités restent signalées comme à venir tant qu’elles ne sont pas renseignées.

L’interface utilise exclusivement un thème sombre, avec des surfaces, cartes, boutons et champs arrondis, des animations discrètes compatibles avec la préférence de réduction des mouvements et des icônes SVG Lucide React pour les flèches.

## Lancer le site

Prérequis : Node.js 20 ou plus récent.

```powershell
npm.cmd start
```

Au démarrage, le serveur charge automatiquement les variables du fichier `.env` situé à la racine du projet; les variables déjà fournies par le système restent prioritaires. Le site écoute sur le port `3000` par défaut. La variable d’environnement `PORT` permet de le modifier. Les tests se lancent avec :

```powershell
npm.cmd test
```

## Administration

Ouvrir `/admin` et définir `ADMIN_PASSWORD` dans `.env` ou dans l’environnement du serveur pour activer le panneau. Le mot de passe doit comporter au moins 16 caractères, être unique et rester privé; aucun accès par défaut n’est activé. `.env.example` répertorie les variables sans valeurs secrètes. Sur l’hébergeur, utiliser son gestionnaire de secrets puis redémarrer l’application.

Le panneau permet de créer, modifier et supprimer des actualités, importer/supprimer des images de galerie, ajouter une couverture aux actualités et modifier les fichiers de textes français, anglais et allemand sans changer leur structure. Les images importées sont limitées à 4 Mo et leur type est vérifié côté serveur. Les changements sont enregistrés directement dans `data/` et `public/`.

La connexion utilise des sessions aléatoires en mémoire, un cookie `HttpOnly`/`SameSite=Strict`, une protection CSRF, une limitation des tentatives et des contrôles d’origine. En production, `NODE_ENV=production` active l’attribut `Secure` du cookie; servir le panneau uniquement derrière HTTPS. Les sessions sont invalidées au redémarrage du serveur. L’administration n’est pas activée si `ADMIN_PASSWORD` manque ou comporte moins de 16 caractères.

## Mettre à jour les contenus

Modifier les fichiers `data/fr.json`, `data/en.json` et `data/de.json`. Conserver les mêmes clés dans chaque fichier et faire relire les traductions avant publication. Les pages sont servies avec le préfixe de langue (`/fr/`, `/en/`, `/de/`).

La liste des attractions et sa source sont centralisées dans `data/attractions.json`. Elle reprend les noms officiels allemands du catalogue Europa-Park, et son statut de construction est indiqué par langue dans les fichiers `data/*.json`.

Les actualités de la page Avancement se gèrent dans `data/actus.json`. Ajouter un objet dans `items` avec un `id` unique en kebab-case, une `date` au format `YYYY-MM-DD` et une traduction `fr` comprenant `title` et `summary`. `category` est facultatif. `body` est une liste facultative de paragraphes. Des traductions `en` et `de` facultatives peuvent reprendre les mêmes champs; si elles manquent, le texte français est affiché. Les articles sont affichés du plus récent au plus ancien. Une image est facultative : la déposer dans `public/actus/` et donner son nom de fichier dans `image` (formats acceptés : `.avif`, `.jpg`, `.jpeg`, `.png`, `.webp`). Le fichier JSON est relu à chaque requête de la page, aucun redémarrage n’est nécessaire après une modification.

Exemple à copier dans `items` (remplacer les champs d’exemple et ne pas le laisser comme fausse actualité) :

```json
{
  "id": "exemple-actualite",
  "date": "2026-10-29",
  "category": "Construction",
  "image": "exemple.webp",
  "translations": {
    "fr": {
      "category": "Construction",
      "title": "Titre de l’actualité",
      "summary": "Un court résumé visible sur la carte.",
      "body": [
        "Premier paragraphe de l’actualité.",
        "Deuxième paragraphe, affiché après ouverture de l’article."
      ]
    },
    "en": {
      "category": "Build update",
      "title": "News headline",
      "summary": "A short summary shown on the card.",
      "body": ["First paragraph of the update."]
    },
    "de": {
      "category": "Baufortschritt",
      "title": "Titel der Neuigkeit",
      "summary": "Eine kurze Zusammenfassung auf der Karte.",
      "body": ["Erster Absatz der Neuigkeit."]
    }
  }
}
```

Dépose les captures directement dans `public/gallery/` : les fichiers `.avif`, `.jpg`, `.jpeg`, `.png` et `.webp` sont détectés automatiquement et apparaissent dans la galerie, dans l’ordre naturel des noms de fichiers (par exemple `image2.png` avant `image10.png`). Les nouveaux fichiers sont pris en compte à la prochaine requête, sans modifier les fichiers de contenu ni redémarrer le serveur. Les noms doivent commencer par une lettre ou un chiffre et ne contenir que des lettres non accentuées, des chiffres, des points, des tirets ou des tirets bas. Le texte alternatif indique qu’il s’agit d’une capture à venir avec son numéro; le clic ouvre l’agrandissement. Ne pas ajouter de visuels non confirmés comme s’il s’agissait de captures du projet.

## Configurer le formulaire

Le serveur doit recevoir `DISCORD_WEBHOOK_URL` comme variable d’environnement privée, dans `.env` en local ou via le gestionnaire de secrets de l’hébergeur. Le serveur ne communique jamais cette URL au navigateur.

Sans URL configurée, le formulaire affiche une erreur claire et ne prétend pas avoir envoyé le message. Avant publication, valider le texte de confidentialité et configurer le webhook dans l’environnement de déploiement.
