FROM node:22-alpine

WORKDIR /app

# poppler-utils fournit la chaîne d'extraction PDF de la collection numérique :
#   pdfinfo   métadonnées et nombre de pages
#   pdftotext texte de la page 1 (devinette du titre) et texte complet (index)
#   pdftoppm  rendu de couverture pour les documents ajoutés hors Calibre
# ~30 Mo d'image. L'alternative en JavaScript pur (pdfjs-dist) est lente et ne
# sait pas produire de JPEG sans `canvas`, qui est lui-même une dépendance
# native : le binaire système est le choix le plus simple et le plus fiable.
RUN apk add --no-cache poppler-utils

# --- irl-books ---
COPY webapp/ ./irl-books/

EXPOSE 8321

# Bibliothèque numérique : l'arborescence Calibre, montée en lecture-écriture
# (des documents y seront ajoutés). Les fichiers ne sont jamais déplacés ni
# copiés — la base ne stocke que des chemins relatifs à cette racine.
#   docker run -v /chemin/vers/CalibreLibrary:/library …
ENV LIBRARY_ROOT=/library
VOLUME ["/library"]

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

CMD ["./docker-entrypoint.sh"]
