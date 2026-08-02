import { loadDatabase, saveDatabase, loadDraft, saveDraft, clearDraft, replaceDatabase } from './storage.js';
import { uid, formatDate, formatDateTime, escapeHtml, downloadJson, slugify } from './utils.js';

let db = loadDatabase();
let currentView = 'dashboard';
let editingVisitId = null;
const app = document.getElementById('app');
const fileInput = document.getElementById('json-file-input');

const visitTypes = ['Bilan 5MVet', 'Audit complet', 'Visite métabolique', 'Audit bâtiment', 'Audit alimentation', 'Audit sanitaire', 'Audit vêlage', 'Audit veaux', 'Suivi', 'Autre'];

function showToast(message) {
  const node = document.getElementById('toast-template').content.firstElementChild.cloneNode(true);
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

function addJournal(visit, message) {
  visit.journal = Array.isArray(visit.journal) ? visit.journal : [];
  visit.journal.unshift({ at: new Date().toISOString(), message });
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  render();
  app.focus({ preventScroll: true });
}

document.querySelector('.top-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});

function farmName(farmId) {
  return db.farms.find(farm => farm.id === farmId)?.name || 'Exploitation non renseignée';
}

function render() {
  const renderers = { dashboard: renderDashboard, farms: renderFarms, visits: renderVisits, backup: renderBackup };
  app.innerHTML = '';
  renderers[currentView]?.();
}

function renderDashboard() {
  const inProgress = db.visits.filter(v => v.status === 'in-progress');
  const complete = db.visits.filter(v => v.status === 'complete');
  const draft = loadDraft();
  app.innerHTML = `
    <section class="grid cols-3">
      <article class="card"><div class="muted">Exploitations</div><div class="metric">${db.farms.length}</div></article>
      <article class="card"><div class="muted">Visites en cours</div><div class="metric">${inProgress.length}</div></article>
      <article class="card"><div class="muted">Visites terminées</div><div class="metric">${complete.length}</div></article>
    </section>
    ${draft ? `<section class="card notice warning" style="margin-top:16px"><strong>Une saisie non finalisée a été retrouvée.</strong><div class="actions" style="margin-top:10px"><button class="btn primary" id="resume-draft">Reprendre la saisie</button><button class="btn secondary" id="discard-draft">Ignorer</button></div></section>` : ''}
    <section class="grid cols-2" style="margin-top:16px">
      <article class="card">
        <h2>Commencer</h2>
        <p class="muted">Créez d’abord l’exploitation, puis la visite. Les informations sont enregistrées automatiquement pendant la saisie.</p>
        <div class="actions"><button class="btn primary" id="new-farm">Nouvelle exploitation</button><button class="btn" id="new-visit">Nouvelle visite</button></div>
      </article>
      <article class="card">
        <h2>Dernières visites</h2>
        ${db.visits.length ? `<ul class="journal">${db.visits.slice().sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5).map(v => `<li><strong>${escapeHtml(farmName(v.farmId))}</strong> — ${formatDate(v.date)}<br><span class="muted">${escapeHtml(v.type || 'Visite')} · ${escapeHtml(v.status === 'complete' ? 'Terminée' : 'En cours')}</span></li>`).join('')}</ul>` : '<div class="empty">Aucune visite enregistrée.</div>'}
      </article>
    </section>`;

  document.getElementById('new-farm').onclick = () => { setView('farms'); setTimeout(() => document.getElementById('farm-name')?.focus(), 0); };
  document.getElementById('new-visit').onclick = () => { setView('visits'); setTimeout(() => document.getElementById('visit-farm')?.focus(), 0); };
  document.getElementById('resume-draft')?.addEventListener('click', () => { setView(draft.kind === 'farm' ? 'farms' : 'visits'); });
  document.getElementById('discard-draft')?.addEventListener('click', () => { clearDraft(); renderDashboard(); });
}

function renderFarms() {
  const draft = loadDraft();
  const farmDraft = draft?.kind === 'farm' ? draft.data : {};
  app.innerHTML = `
    <div class="section-title"><h2>Exploitations</h2><span class="muted">${db.farms.length} exploitation(s)</span></div>
    <section class="grid cols-2">
      <form id="farm-form" class="card">
        <h3>Ajouter une exploitation</h3>
        <div class="field"><label for="farm-name">Nom de l’exploitation *</label><input id="farm-name" name="name" required value="${escapeHtml(farmDraft.name || '')}" /></div>
        <div class="row"><div class="field"><label>Éleveur</label><input name="farmer" value="${escapeHtml(farmDraft.farmer || '')}" /></div><div class="field"><label>Commune</label><input name="commune" value="${escapeHtml(farmDraft.commune || '')}" /></div></div>
        <div class="row"><div class="field"><label>Téléphone</label><input name="phone" inputmode="tel" value="${escapeHtml(farmDraft.phone || '')}" /></div><div class="field"><label>Courriel</label><input name="email" type="email" value="${escapeHtml(farmDraft.email || '')}" /></div></div>
        <div class="field"><label>Informations permanentes</label><textarea name="notes">${escapeHtml(farmDraft.notes || '')}</textarea></div>
        <button class="btn primary" type="submit">Ajouter l’exploitation</button>
      </form>
      <section class="card">
        <h3>Liste des exploitations</h3>
        ${db.farms.length ? `<div class="table-wrap"><table><thead><tr><th>Exploitation</th><th>Commune</th><th>Visites</th><th></th></tr></thead><tbody>${db.farms.map(f => `<tr><td><strong>${escapeHtml(f.name)}</strong><br><span class="muted">${escapeHtml(f.farmer || '')}</span></td><td>${escapeHtml(f.commune || '—')}</td><td>${db.visits.filter(v => v.farmId === f.id).length}</td><td><button class="btn small danger" data-delete-farm="${f.id}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune exploitation.</div>'}
      </section>
    </section>`;
  const form = document.getElementById('farm-form');
  form.addEventListener('input', () => saveDraft({ kind: 'farm', data: Object.fromEntries(new FormData(form)) }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim()) return;
    db.farms.push({ id: uid('farm'), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    saveDatabase(db); clearDraft(); showToast('Exploitation ajoutée.'); renderFarms();
  });
  app.querySelectorAll('[data-delete-farm]').forEach(button => button.onclick = () => {
    const id = button.dataset.deleteFarm;
    if (db.visits.some(v => v.farmId === id)) return showToast('Suppression impossible : cette exploitation possède des visites.');
    if (confirm('Supprimer cette exploitation ?')) { db.farms = db.farms.filter(f => f.id !== id); saveDatabase(db); renderFarms(); }
  });
}

function visitFormHtml(visit = {}) {
  const draft = loadDraft();
  const visitDraft = draft?.kind === 'visit' ? draft.data : {};
  const data = { ...visitDraft, ...visit };
  return `<form id="visit-form" class="card">
    <h3>${visit.id ? 'Modifier la visite' : 'Nouvelle visite'}</h3>
    ${!db.farms.length ? '<div class="notice warning">Ajoutez d’abord une exploitation.</div>' : ''}
    <div class="field"><label for="visit-farm">Exploitation *</label><select id="visit-farm" name="farmId" required><option value="">Sélectionner…</option>${db.farms.map(f => `<option value="${f.id}" ${data.farmId===f.id?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}</select></div>
    <div class="row"><div class="field"><label>Date *</label><input name="date" type="date" required value="${escapeHtml(data.date || new Date().toISOString().slice(0,10))}" /></div><div class="field"><label>Technicien</label><input name="technician" value="${escapeHtml(data.technician || '')}" /></div></div>
    <div class="field"><label>Type de visite</label><select name="type">${visitTypes.map(type => `<option ${data.type===type?'selected':''}>${type}</option>`).join('')}</select></div>
    <div class="field"><label>Objectif / attentes</label><textarea name="objective">${escapeHtml(data.objective || '')}</textarea></div>
    <div class="field"><label>Statut</label><select name="status"><option value="in-progress" ${data.status!=='complete'?'selected':''}>En cours</option><option value="complete" ${data.status==='complete'?'selected':''}>Terminée</option></select></div>
    <div class="actions"><button class="btn primary" type="submit">${visit.id ? 'Mettre à jour' : 'Créer la visite'}</button>${visit.id ? '<button type="button" class="btn secondary" id="cancel-edit">Annuler</button>' : ''}</div>
  </form>`;
}

function renderVisits() {
  const editVisit = editingVisitId ? db.visits.find(v => v.id === editingVisitId) : null;
  app.innerHTML = `
    <div class="section-title"><h2>Visites</h2><span class="muted">Sauvegarde automatique active</span></div>
    <section class="grid cols-2">
      ${visitFormHtml(editVisit || {})}
      <section class="card">
        <h3>Historique</h3>
        ${db.visits.length ? `<div class="table-wrap"><table><thead><tr><th>Exploitation</th><th>Date</th><th>Type</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${db.visits.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(v => `<tr><td><strong>${escapeHtml(farmName(v.farmId))}</strong><br><span class="muted">${escapeHtml(v.technician || '')}</span></td><td>${formatDate(v.date)}</td><td>${escapeHtml(v.type || '—')}</td><td><span class="badge ${v.status==='complete'?'complete':'in-progress'}">${v.status==='complete'?'Terminée':'En cours'}</span></td><td><div class="actions"><button class="btn small" data-edit-visit="${v.id}">Ouvrir</button><button class="btn small" data-export-visit="${v.id}">JSON</button><button class="btn small danger" data-delete-visit="${v.id}">Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune visite.</div>'}
      </section>
    </section>
    ${editVisit ? `<section class="card" style="margin-top:16px"><h3>Journal de la visite</h3>${editVisit.journal?.length ? `<ul class="journal">${editVisit.journal.map(j => `<li><strong>${formatDateTime(j.at)}</strong><br>${escapeHtml(j.message)}</li>`).join('')}</ul>` : '<div class="empty">Aucune modification enregistrée.</div>'}</section>` : ''}`;

  const form = document.getElementById('visit-form');
  form.addEventListener('input', () => saveDraft({ kind: 'visit', data: Object.fromEntries(new FormData(form)) }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.farmId || !data.date) return showToast('Exploitation et date obligatoires.');
    if (editVisit) {
      Object.assign(editVisit, data, { updatedAt: new Date().toISOString() });
      addJournal(editVisit, 'Informations générales mises à jour.');
      showToast('Visite mise à jour.');
    } else {
      const visit = { id: uid('visit'), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), journal: [] };
      addJournal(visit, 'Visite créée.');
      db.visits.push(visit);
      showToast('Visite créée.');
    }
    saveDatabase(db); clearDraft(); editingVisitId = null; renderVisits();
  });
  document.getElementById('cancel-edit')?.addEventListener('click', () => { editingVisitId = null; clearDraft(); renderVisits(); });
  app.querySelectorAll('[data-edit-visit]').forEach(button => button.onclick = () => { editingVisitId = button.dataset.editVisit; clearDraft(); renderVisits(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  app.querySelectorAll('[data-export-visit]').forEach(button => button.onclick = () => {
    const visit = db.visits.find(v => v.id === button.dataset.exportVisit);
    downloadJson(`${slugify(farmName(visit.farmId))}-${visit.date || 'visite'}.json`, { schemaVersion: 1, farm: db.farms.find(f => f.id === visit.farmId), visit });
  });
  app.querySelectorAll('[data-delete-visit]').forEach(button => button.onclick = () => {
    if (confirm('Supprimer cette visite ?')) { db.visits = db.visits.filter(v => v.id !== button.dataset.deleteVisit); saveDatabase(db); renderVisits(); }
  });
}

function renderBackup() {
  app.innerHTML = `
    <div class="section-title"><h2>Sauvegarde et transfert</h2></div>
    <section class="grid cols-2">
      <article class="card"><h3>Enregistrer toute la base</h3><p class="muted">Exporte toutes les exploitations et toutes les visites dans un fichier JSON.</p><button class="btn primary" id="export-db">Télécharger la sauvegarde complète</button></article>
      <article class="card"><h3>Ouvrir une sauvegarde</h3><p class="muted">Remplace la base locale par le contenu d’un fichier JSON précédemment exporté.</p><button class="btn" id="import-db">Choisir un fichier JSON</button></article>
      <article class="card"><h3>État de la sauvegarde locale</h3><p>Dernière modification : <strong>${formatDateTime(db.updatedAt)}</strong></p><p class="muted">La base est enregistrée automatiquement dans le navigateur à chaque création ou modification.</p></article>
      <article class="card"><h3>Réinitialiser</h3><p class="muted">Efface toutes les exploitations et visites de cet appareil.</p><button class="btn danger" id="reset-db">Tout effacer</button></article>
    </section>`;
  document.getElementById('export-db').onclick = () => downloadJson(`audit-bovin-sauvegarde-${new Date().toISOString().slice(0,10)}.json`, db);
  document.getElementById('import-db').onclick = () => fileInput.click();
  document.getElementById('reset-db').onclick = () => {
    if (confirm('Effacer définitivement toutes les données de cet appareil ?')) { db = replaceDatabase({ farms: [], visits: [] }); clearDraft(); showToast('Base locale effacée.'); renderBackup(); }
  };
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.farm && parsed.visit) {
      const farm = parsed.farm;
      const existingFarm = db.farms.find(f => f.id === farm.id) || db.farms.find(f => f.name.toLowerCase() === farm.name.toLowerCase());
      const farmId = existingFarm?.id || farm.id || uid('farm');
      if (!existingFarm) db.farms.push({ ...farm, id: farmId });
      db.visits = db.visits.filter(v => v.id !== parsed.visit.id);
      db.visits.push({ ...parsed.visit, farmId });
      saveDatabase(db);
      showToast('Visite importée.');
    } else if (Array.isArray(parsed.farms) && Array.isArray(parsed.visits)) {
      db = replaceDatabase(parsed);
      showToast('Sauvegarde complète restaurée.');
    } else {
      throw new Error('Format non reconnu');
    }
    render();
  } catch (error) {
    console.error(error);
    alert('Ce fichier JSON ne correspond pas à une sauvegarde Audit Bovin valide.');
  } finally {
    fileInput.value = '';
  }
});

window.addEventListener('error', event => {
  console.error(event.error || event.message);
  const errorBox = document.createElement('div');
  errorBox.className = 'card notice warning';
  errorBox.innerHTML = `<strong>Une erreur a été détectée.</strong><br><span class="muted">${escapeHtml(event.message || 'Erreur inconnue')}</span>`;
  app.prepend(errorBox);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
render();
