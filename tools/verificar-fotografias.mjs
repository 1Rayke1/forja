/* Validação de orçamento, não prova de direitos ou de correspondência visual. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHOTO_BUDGET = Object.freeze({ count: 8, each: 100 * 1024, total: 800 * 1024 });
export function checkPhotoBudget(manifest, root, read = fs.readFileSync) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifesto inválido');
  const photos = Object.values(manifest);
  if (photos.length > PHOTO_BUDGET.count) throw new Error('Mais de 8 fotografias');
  let bytes = 0;
  for (const photo of photos) {
    if (!photo || typeof photo.src !== 'string' || !/^assets\/exercicios\/[a-z0-9-]+\.(webp|jpg|png)$/.test(photo.src)) throw new Error('Caminho inválido');
    const content = read(path.join(root, photo.src)); // arquivo ausente também reprova
    if (!Buffer.isBuffer(content) || !content.length || content.length > PHOTO_BUDGET.each) throw new Error('Arquivo vazio ou acima de 100 KiB');
    bytes += content.length;
  }
  if (bytes > PHOTO_BUDGET.total) throw new Error('Lote acima de 800 KiB');
  return { count: photos.length, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Reutiliza o harness/dependências existentes; nunca faz download de fotos.
  const { boot, closeAllApps, repoRoot } = await import('../tests/helpers/harness.mjs');
  try {
    const app = await boot({}, 'treino/biblioteca.html');
    const catalog = app.F.catalog;
    for (const [key, photo] of Object.entries(catalog.PHOTO_MANIFEST)) {
      if (!catalog.validPhoto(photo) || key !== photo.mode + ':' + photo.exerciseId) throw new Error('Metadados inválidos: ' + key);
      const record = catalog.items(photo.mode).find(item => item.id === photo.exerciseId);
      if (catalog.photoFor(record) !== photo) throw new Error('Origem/variante inválida: ' + key);
    }
    console.log('Orçamento de fotografias:', checkPhotoBudget(catalog.PHOTO_MANIFEST, repoRoot));
  } finally { closeAllApps(); }
}
