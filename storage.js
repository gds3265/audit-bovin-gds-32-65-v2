const DB_KEY = 'audit-bovin-v10-core';
const DRAFT_KEY = 'audit-bovin-v10-draft';

export function createEmptyDatabase() {
  return { schemaVersion: 1, farms: [], visits: [], updatedAt: new Date().toISOString() };
}

export function loadDatabase() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return createEmptyDatabase();
    const parsed = JSON.parse(raw);
    return { ...createEmptyDatabase(), ...parsed };
  } catch (error) {
    console.error('Impossible de charger la base locale', error);
    return createEmptyDatabase();
  }
}

function compactDatabaseForStorage(source) {
  const db = source && typeof source === 'object' ? source : createEmptyDatabase();
  if (Array.isArray(db.herdImports)) {
    db.herdImports = db.herdImports.map(item => {
      if (!item || typeof item !== 'object') return item;
      const { raw, ...clean } = item;
      return clean;
    });
  }
  if (Array.isArray(db.visits)) {
    db.visits.forEach(visit => {
      const imported = visit?.auditGlobal?.importedHerdData;
      if (imported && typeof imported === 'object') {
        delete imported.snapshot;
        delete imported.raw;
      }
    });
  }
  return db;
}

export function saveDatabase(db) {
  db.updatedAt = new Date().toISOString();
  compactDatabaseForStorage(db);
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (error) {
    console.error('Sauvegarde locale impossible', error);
    const message = error?.name === 'QuotaExceededError'
      ? 'La mémoire locale de l’appareil est pleine. Exportez une sauvegarde puis supprimez les photos ou documents très lourds.'
      : `Sauvegarde locale impossible : ${error?.message || error}`;
    window.dispatchEvent(new CustomEvent('audit-bovin-save-error', { detail: { message } }));
    throw error;
  }
  window.dispatchEvent(new CustomEvent('audit-bovin-db-saved', { detail: { updatedAt: db.updatedAt } }));
}


export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
  catch { return null; }
}

export function saveDraft(draft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export function replaceDatabase(nextDb) {
  const normalized = compactDatabaseForStorage({ ...createEmptyDatabase(), ...nextDb, updatedAt: new Date().toISOString() });
  localStorage.setItem(DB_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent('audit-bovin-db-saved', { detail: { updatedAt: normalized.updatedAt } }));
  return normalized;
}
