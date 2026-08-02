import { loadDatabase, saveDatabase, loadDraft, saveDraft, clearDraft, replaceDatabase } from './storage.js';
import { uid, formatDate, formatDateTime, escapeHtml, downloadJson, slugify } from './utils.js';

let db = loadDatabase();
let currentView = 'dashboard';
let editingVisitId = null;
let activeAnimalVisitId = localStorage.getItem('audit-bovin-active-animal-visit') || '';
let openSubjectId = null;
const app = document.getElementById('app');
const fileInput = document.getElementById('json-file-input');

const visitTypes = ['Bilan 5MVet', 'Audit complet', 'Visite métabolique', 'Audit bâtiment', 'Audit alimentation', 'Audit sanitaire', 'Audit vêlage', 'Audit veaux', 'Suivi', 'Autre'];
const categories = ['Non classé', 'Veau 0–15 jours', 'Veau 15–60 jours', 'Génisse', 'Engraissement', 'Préparation vêlage', 'Tarie', 'Fraîche vêlée', 'Début lactation', 'Pic de lactation', 'Milieu lactation', 'Fin lactation', 'Vache allaitante', 'Autre'];
const physiologicalStages = ['Non renseigné', 'Vide', 'Synchronisation des chaleurs', 'Pleine', 'Lactation'];
const measurementFamilies = [
  ['urine', 'Urines', '🟡'], ['blood', 'Sang', '🔴'], ['feces', 'Bouses', '🟤'],
  ['physical', 'Observations physiques', '🟢'], ['milk', 'Lait', '🔵'], ['colostrum', 'Colostrum', '🟣']
];

function migrateDatabase() {
  db.farms = Array.isArray(db.farms) ? db.farms : [];
  db.visits = Array.isArray(db.visits) ? db.visits : [];
  db.visits.forEach(visit => {
    visit.subjects = Array.isArray(visit.subjects) ? visit.subjects : [];
    visit.subjects.forEach(subject => {
      subject.measurements = subject.measurements && typeof subject.measurements === 'object' ? subject.measurements : {};
    });
  });
  if (activeAnimalVisitId && !db.visits.some(v => v.id === activeAnimalVisitId)) activeAnimalVisitId = '';
  saveDatabase(db);
}
migrateDatabase();

function showToast(message) {
  const node = document.getElementById('toast-template').content.firstElementChild.cloneNode(true);
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
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

function visitLabel(visit) {
  return `${farmName(visit.farmId)} — ${formatDate(visit.date)} — ${visit.type || 'Visite'}`;
}

function render() {
  const renderers = { dashboard: renderDashboard, farms: renderFarms, visits: renderVisits, animals: renderAnimals, backup: renderBackup };
  app.innerHTML = '';
  renderers[currentView]?.();
}

function renderDashboard() {
  const inProgress = db.visits.filter(v => v.status === 'in-progress');
  const complete = db.visits.filter(v => v.status === 'complete');
  const subjectCount = db.visits.reduce((sum, visit) => sum + (visit.subjects?.length || 0), 0);
  const draft = loadDraft();
  app.innerHTML = `
    <section class="grid cols-4">
      <article class="card"><div class="muted">Exploitations</div><div class="metric">${db.farms.length}</div></article>
      <article class="card"><div class="muted">Visites en cours</div><div class="metric">${inProgress.length}</div></article>
      <article class="card"><div class="muted">Visites terminées</div><div class="metric">${complete.length}</div></article>
      <article class="card"><div class="muted">Sujets enregistrés</div><div class="metric">${subjectCount}</div></article>
    </section>
    ${draft ? `<section class="card notice warning" style="margin-top:16px"><strong>Une saisie non finalisée a été retrouvée.</strong><div class="actions" style="margin-top:10px"><button class="btn primary" id="resume-draft">Reprendre la saisie</button><button class="btn secondary" id="discard-draft">Ignorer</button></div></section>` : ''}
    <section class="grid cols-2" style="margin-top:16px">
      <article class="card">
        <h2>Commencer</h2>
        <p class="muted">Les données sont enregistrées automatiquement. Créez une visite, puis ajoutez les sujets dans l’onglet Animaux.</p>
        <div class="actions"><button class="btn primary" id="new-farm">Nouvelle exploitation</button><button class="btn" id="new-visit">Nouvelle visite</button><button class="btn" id="open-animals">Ouvrir les animaux</button></div>
      </article>
      <article class="card">
        <h2>Dernières visites</h2>
        ${db.visits.length ? `<ul class="journal">${db.visits.slice().sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5).map(v => `<li><strong>${escapeHtml(farmName(v.farmId))}</strong> — ${formatDate(v.date)}<br><span class="muted">${escapeHtml(v.type || 'Visite')} · ${v.subjects?.length || 0} sujet(s) · ${escapeHtml(v.status === 'complete' ? 'Terminée' : 'En cours')}</span></li>`).join('')}</ul>` : '<div class="empty">Aucune visite enregistrée.</div>'}
      </article>
    </section>`;

  document.getElementById('new-farm').onclick = () => { setView('farms'); setTimeout(() => document.getElementById('farm-name')?.focus(), 0); };
  document.getElementById('new-visit').onclick = () => { setView('visits'); setTimeout(() => document.getElementById('visit-farm')?.focus(), 0); };
  document.getElementById('open-animals').onclick = () => setView('animals');
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
        ${db.visits.length ? `<div class="table-wrap"><table><thead><tr><th>Exploitation</th><th>Date</th><th>Type</th><th>Sujets</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${db.visits.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(v => `<tr><td><strong>${escapeHtml(farmName(v.farmId))}</strong><br><span class="muted">${escapeHtml(v.technician || '')}</span></td><td>${formatDate(v.date)}</td><td>${escapeHtml(v.type || '—')}</td><td>${v.subjects?.length || 0}</td><td><span class="badge ${v.status==='complete'?'complete':'in-progress'}">${v.status==='complete'?'Terminée':'En cours'}</span></td><td><div class="actions"><button class="btn small" data-edit-visit="${v.id}">Ouvrir</button><button class="btn small" data-open-animals="${v.id}">Animaux</button><button class="btn small" data-export-visit="${v.id}">JSON</button><button class="btn small danger" data-delete-visit="${v.id}">Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune visite.</div>'}
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
      const visit = { id: uid('visit'), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), journal: [], subjects: [] };
      addJournal(visit, 'Visite créée.');
      db.visits.push(visit);
      activeAnimalVisitId = visit.id;
      localStorage.setItem('audit-bovin-active-animal-visit', visit.id);
      showToast('Visite créée.');
    }
    saveDatabase(db); clearDraft(); editingVisitId = null; renderVisits();
  });
  document.getElementById('cancel-edit')?.addEventListener('click', () => { editingVisitId = null; clearDraft(); renderVisits(); });
  app.querySelectorAll('[data-edit-visit]').forEach(button => button.onclick = () => { editingVisitId = button.dataset.editVisit; clearDraft(); renderVisits(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  app.querySelectorAll('[data-open-animals]').forEach(button => button.onclick = () => {
    activeAnimalVisitId = button.dataset.openAnimals;
    localStorage.setItem('audit-bovin-active-animal-visit', activeAnimalVisitId);
    setView('animals');
  });
  app.querySelectorAll('[data-export-visit]').forEach(button => button.onclick = () => {
    const visit = db.visits.find(v => v.id === button.dataset.exportVisit);
    downloadJson(`${slugify(farmName(visit.farmId))}-${visit.date || 'visite'}.json`, { schemaVersion: 2, farm: db.farms.find(f => f.id === visit.farmId), visit });
  });
  app.querySelectorAll('[data-delete-visit]').forEach(button => button.onclick = () => {
    if (confirm('Supprimer cette visite et tous ses sujets ?')) {
      db.visits = db.visits.filter(v => v.id !== button.dataset.deleteVisit);
      if (activeAnimalVisitId === button.dataset.deleteVisit) activeAnimalVisitId = '';
      saveDatabase(db); renderVisits();
    }
  });
}

function classificationCompleteness(subject) {
  const fields = [subject.category, subject.stage, subject.age, subject.rank, subject.lot];
  return fields.filter(value => value && !['Non classé', 'Non renseigné'].includes(value)).length;
}

function measurementStatus(subject, key) {
  const value = subject.measurements?.[key];
  if (!value) return 'none';
  if (value === true || value.status === 'complete') return 'complete';
  return 'partial';
}

function subjectCardHtml(subject, index) {
  const isOpen = openSubjectId === subject.id;
  const category = subject.category || 'Non classé';
  const stageDetail = subject.stage === 'Pleine' && subject.gestationMonths ? `${subject.gestationMonths} mois` : subject.stage === 'Lactation' && subject.lactationDays ? `${subject.lactationDays} JEL` : subject.stage || 'Non renseigné';
  return `<article class="subject-card ${isOpen ? 'open' : ''}" data-subject-card="${subject.id}">
    <button type="button" class="subject-summary" data-toggle-subject="${subject.id}" aria-expanded="${isOpen}">
      <span class="subject-number">${index + 1}</span>
      <span class="subject-main"><strong>${escapeHtml(subject.tag || `Sujet ${index + 1}`)}</strong><small>${escapeHtml(subject.location || 'Emplacement non renseigné')}</small></span>
      <span class="subject-class"><span class="badge ${category === 'Non classé' ? 'unclassified' : 'complete'}">${escapeHtml(category)}</span><small>${escapeHtml(stageDetail)}</small></span>
      <span class="chevron">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen ? subjectDetailsHtml(subject) : ''}
  </article>`;
}

function subjectDetailsHtml(subject) {
  return `<form class="subject-details" data-subject-form="${subject.id}">
    <div class="grid cols-2">
      <section>
        <h4>Identification</h4>
        <div class="row"><div class="field"><label>Numéro de boucle / repère</label><input name="tag" value="${escapeHtml(subject.tag || '')}" required /></div><div class="field"><label>Nom (facultatif)</label><input name="name" value="${escapeHtml(subject.name || '')}" /></div></div>
        <div class="field"><label>Emplacement</label><input name="location" value="${escapeHtml(subject.location || '')}" placeholder="Ex. 2e place, 3e travée" /></div>
        <div class="field"><label>Observation d’identification</label><textarea name="notes" placeholder="Ex. corne cassée, robe particulière…">${escapeHtml(subject.notes || '')}</textarea></div>
      </section>
      <section>
        <h4>Classement</h4>
        <div class="field"><label>Catégorie</label><select name="category">${categories.map(value => `<option ${subject.category === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div class="field"><label>Stade physiologique</label><select name="stage">${physiologicalStages.map(value => `<option ${subject.stage === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div class="row"><div class="field"><label>Mois de gestation</label><input name="gestationMonths" type="number" min="1" max="9" inputmode="numeric" value="${escapeHtml(subject.gestationMonths || '')}" /></div><div class="field"><label>Jours en lactation</label><input name="lactationDays" type="number" min="0" inputmode="numeric" value="${escapeHtml(subject.lactationDays || '')}" /></div></div>
        <div class="row"><div class="field"><label>Âge</label><input name="age" value="${escapeHtml(subject.age || '')}" placeholder="Ex. 4 ans" /></div><div class="field"><label>Rang</label><input name="rank" type="number" min="0" inputmode="numeric" value="${escapeHtml(subject.rank || '')}" /></div></div>
        <div class="field"><label>Lot</label><input name="lot" value="${escapeHtml(subject.lot || '')}" /></div>
      </section>
    </div>
    <section class="measurement-overview"><h4>Suivi des mesures</h4><div class="measure-chips">${measurementFamilies.map(([key,label,icon]) => { const status = measurementStatus(subject,key); return `<span class="measure-chip ${status}">${icon} ${label}<small>${status === 'complete' ? 'Fait' : status === 'partial' ? 'Partiel' : 'Non réalisé'}</small></span>`; }).join('')}</div><p class="muted small-text">La saisie détaillée des mesures sera ajoutée dans le module suivant. Les emplacements sont déjà réservés dans la fiche du sujet.</p></section>
    <div class="actions subject-actions"><span class="autosave-indicator">✓ Enregistrement automatique</span><button type="button" class="btn danger" data-delete-subject="${subject.id}">Supprimer le sujet</button></div>
  </form>`;
}

function renderAnimals() {
  const visits = db.visits.slice().sort((a,b) => (b.date || '').localeCompare(a.date || ''));
  if (!activeAnimalVisitId && visits.length) activeAnimalVisitId = visits[0].id;
  const visit = db.visits.find(v => v.id === activeAnimalVisitId);
  app.innerHTML = `
    <div class="section-title"><div><h2>Animaux / sujets de la visite</h2><div class="muted">Saisir d’abord le numéro de boucle et l’emplacement. Le classement peut être complété plus tard.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
    <section class="card animal-visit-selector">
      <div class="field no-margin"><label for="animal-visit-select">Visite active</label><select id="animal-visit-select"><option value="">Sélectionner une visite…</option>${visits.map(v => `<option value="${v.id}" ${v.id === activeAnimalVisitId ? 'selected' : ''}>${escapeHtml(visitLabel(v))}</option>`).join('')}</select></div>
      ${visit ? `<div class="visit-meta"><strong>${escapeHtml(farmName(visit.farmId))}</strong><span>${formatDate(visit.date)}</span><span>${escapeHtml(visit.type || '')}</span><span>${visit.subjects?.length || 0} sujet(s)</span></div>` : ''}
    </section>
    ${!visit ? `<section class="empty" style="margin-top:16px">Créez ou sélectionnez une visite avant d’ajouter des sujets.</section>` : `
      <section class="grid cols-2 animal-workspace" style="margin-top:16px">
        <form id="quick-subject-form" class="card quick-subject-form">
          <h3>Ajouter un sujet</h3>
          <p class="muted">Seuls le numéro de boucle et l’emplacement sont nécessaires au départ.</p>
          <div class="field"><label for="subject-tag">Numéro de boucle / repère *</label><input id="subject-tag" name="tag" required autocomplete="off" placeholder="Ex. FR6501234567" /></div>
          <div class="field"><label for="subject-location">Emplacement</label><input id="subject-location" name="location" autocomplete="off" placeholder="Ex. 2e place, 3e travée" /></div>
          <button type="submit" class="btn primary">Ajouter le sujet</button>
        </form>
        <article class="card">
          <h3>Avancement du classement</h3>
          ${visit.subjects?.length ? `<div class="progress-list">${visit.subjects.map(s => `<div><span>${escapeHtml(s.tag || 'Sujet')}</span><div class="progress-track"><div style="width:${classificationCompleteness(s) / 5 * 100}%"></div></div><small>${classificationCompleteness(s)}/5 informations</small></div>`).join('')}</div>` : '<div class="empty">Aucun sujet pour cette visite.</div>'}
        </article>
      </section>
      <section style="margin-top:16px">
        <div class="section-title"><h3>Liste des sujets</h3><span class="muted">Cliquez sur une fiche pour la compléter</span></div>
        <div class="subject-list">${visit.subjects?.length ? visit.subjects.map(subjectCardHtml).join('') : '<div class="empty">Aucun sujet. Ajoutez le premier animal avec le formulaire ci-dessus.</div>'}</div>
      </section>`}`;

  document.getElementById('animal-visit-select').addEventListener('change', event => {
    activeAnimalVisitId = event.target.value;
    localStorage.setItem('audit-bovin-active-animal-visit', activeAnimalVisitId);
    openSubjectId = null;
    renderAnimals();
  });

  const quickForm = document.getElementById('quick-subject-form');
  quickForm?.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(quickForm));
    const tag = data.tag.trim();
    if (!tag) return showToast('Le numéro de boucle ou le repère est obligatoire.');
    if (visit.subjects.some(subject => subject.tag?.trim().toLowerCase() === tag.toLowerCase())) return showToast('Ce numéro est déjà présent dans la visite.');
    const subject = {
      id: uid('subject'), tag, location: data.location.trim(), name: '', category: 'Non classé', stage: 'Non renseigné',
      gestationMonths: '', lactationDays: '', age: '', rank: '', lot: '', notes: '', measurements: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    visit.subjects.push(subject);
    visit.updatedAt = new Date().toISOString();
    addJournal(visit, `Sujet ajouté : ${tag}.`);
    saveDatabase(db);
    openSubjectId = subject.id;
    showToast('Sujet ajouté et enregistré.');
    renderAnimals();
    setTimeout(() => document.querySelector(`[data-subject-card="${subject.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  });

  app.querySelectorAll('[data-toggle-subject]').forEach(button => button.addEventListener('click', () => {
    openSubjectId = openSubjectId === button.dataset.toggleSubject ? null : button.dataset.toggleSubject;
    renderAnimals();
    if (openSubjectId) setTimeout(() => document.querySelector(`[data-subject-card="${openSubjectId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }));

  app.querySelectorAll('[data-subject-form]').forEach(form => {
    const subject = visit.subjects.find(item => item.id === form.dataset.subjectForm);
    const autosave = () => {
      const values = Object.fromEntries(new FormData(form));
      Object.assign(subject, values, { updatedAt: new Date().toISOString() });
      visit.updatedAt = new Date().toISOString();
      saveDatabase(db);
      const indicator = form.querySelector('.autosave-indicator');
      if (indicator) { indicator.textContent = '✓ Enregistré'; setTimeout(() => { indicator.textContent = '✓ Enregistrement automatique'; }, 1200); }
      const headerBadge = document.querySelector(`[data-subject-card="${subject.id}"] .subject-class .badge`);
      if (headerBadge) headerBadge.textContent = subject.category || 'Non classé';
    };
    form.addEventListener('input', autosave);
    form.addEventListener('change', autosave);
  });

  app.querySelectorAll('[data-delete-subject]').forEach(button => button.addEventListener('click', () => {
    const subject = visit.subjects.find(item => item.id === button.dataset.deleteSubject);
    if (!subject || !confirm(`Supprimer le sujet ${subject.tag || ''} ?`)) return;
    visit.subjects = visit.subjects.filter(item => item.id !== subject.id);
    visit.updatedAt = new Date().toISOString();
    addJournal(visit, `Sujet supprimé : ${subject.tag || 'sans numéro'}.`);
    saveDatabase(db); openSubjectId = null; showToast('Sujet supprimé.'); renderAnimals();
  }));
}

function renderBackup() {
  app.innerHTML = `
    <div class="section-title"><h2>Sauvegarde et transfert</h2></div>
    <section class="grid cols-2">
      <article class="card"><h3>Enregistrer toute la base</h3><p class="muted">Exporte toutes les exploitations, visites et sujets dans un fichier JSON.</p><button class="btn primary" id="export-db">Télécharger la sauvegarde complète</button></article>
      <article class="card"><h3>Ouvrir une sauvegarde</h3><p class="muted">Remplace la base locale par le contenu d’un fichier JSON précédemment exporté.</p><button class="btn" id="import-db">Choisir un fichier JSON</button></article>
      <article class="card"><h3>État de la sauvegarde locale</h3><p>Dernière modification : <strong>${formatDateTime(db.updatedAt)}</strong></p><p class="muted">La base est enregistrée automatiquement à chaque création ou modification.</p></article>
      <article class="card"><h3>Réinitialiser</h3><p class="muted">Efface toutes les exploitations, visites et sujets de cet appareil.</p><button class="btn danger" id="reset-db">Tout effacer</button></article>
    </section>`;
  document.getElementById('export-db').onclick = () => downloadJson(`audit-bovin-sauvegarde-${new Date().toISOString().slice(0,10)}.json`, db);
  document.getElementById('import-db').onclick = () => fileInput.click();
  document.getElementById('reset-db').onclick = () => {
    if (confirm('Effacer définitivement toutes les données de cet appareil ?')) { db = replaceDatabase({ farms: [], visits: [] }); clearDraft(); activeAnimalVisitId = ''; showToast('Base locale effacée.'); renderBackup(); }
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
      db.visits.push({ ...parsed.visit, farmId, subjects: Array.isArray(parsed.visit.subjects) ? parsed.visit.subjects : [] });
      saveDatabase(db);
      showToast('Visite importée.');
    } else if (Array.isArray(parsed.farms) && Array.isArray(parsed.visits)) {
      db = replaceDatabase(parsed);
      migrateDatabase();
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
