# Signature de code du launcher (Windows)

Sans signature, Windows SmartScreen affiche un avertissement « éditeur inconnu » à
l'installation, et l'intégrité des mises à jour repose uniquement sur le compte GitHub.
La signature lie chaque installeur/binaire à **ton** identité d'éditeur.

La chaîne de release est **déjà prête** : dès que les deux secrets ci-dessous existent dans
le dépôt, la CI signe automatiquement l'installeur. Sans eux, le build reste non signé (il
n'échoue pas).

## 1. Obtenir un certificat

Au choix :
- **Azure Trusted Signing** (~10 $/mois) — recommandé, le plus simple aujourd'hui, pas de clé à manipuler.
- **Certificat OV Authenticode** (~150–250 €/an) chez un AC (Sectigo, DigiCert…). Tu obtiens un `.pfx` + un mot de passe.
- (Un certificat **auto-signé** ne sert à rien contre SmartScreen — à éviter.)

## 2. Ajouter les secrets GitHub (pour un .pfx)

1. Encode le `.pfx` en base64 :
   - PowerShell : `[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificat.pfx")) | Set-Clipboard`
2. Dépôt `meytopia-launcher` → **Settings → Secrets and variables → Actions → New repository secret** :
   - `CSC_LINK` = la chaîne base64 du `.pfx`
   - `CSC_KEY_PASSWORD` = le mot de passe du `.pfx`
3. Pousse un tag `vX.Y.Z` comme d'habitude → la CI signe l'installeur automatiquement
   (`.github/workflows/release.yml`, étape « Build de l'installeur »).

> Pour **Azure Trusted Signing**, utiliser plutôt `electron-builder` avec `win.azureSignOptions`
> (config dans `package.json`) + les secrets Azure correspondants ; voir la doc electron-builder.

## 3. Vérifier

Après une release signée : clic droit sur l'installeur → Propriétés → onglet **Signatures numériques**
doit montrer ton éditeur. `electron-updater` vérifiera alors aussi l'éditeur à la mise à jour.

## Sécurité opérationnelle (le plus important, gratuit)

- Active la **2FA matérielle** sur le compte GitHub propriétaire.
- Limite les collaborateurs et la portée des jetons de publication.
- Ne committe jamais le `.pfx` ni le mot de passe (ils ne vivent que dans les secrets GitHub).
