import { loadDatabase, saveDatabase, loadDraft, saveDraft, clearDraft, replaceDatabase } from './storage.js';
import { uid, formatDate, formatDateTime, escapeHtml, downloadJson, slugify } from './utils.js';
import { THRESHOLDS, CATEGORY_RULE_MAP } from './analysis-rules.js';

let db = loadDatabase();
let currentView = 'dashboard';
let editingVisitId = null;
let activeAnimalVisitId = localStorage.getItem('audit-bovin-active-animal-visit') || '';
let openSubjectId = null;
let activeAnalysisVisitId = localStorage.getItem('audit-bovin-active-analysis-visit') || '';
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
      subject.measurements.analysis = subject.measurements.analysis && typeof subject.measurements.analysis === 'object' ? subject.measurements.analysis : {};
    });
  });
  if (activeAnimalVisitId && !db.visits.some(v => v.id === activeAnimalVisitId)) activeAnimalVisitId = '';
  if (activeAnalysisVisitId && !db.visits.some(v => v.id === activeAnalysisVisitId)) activeAnalysisVisitId = '';
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
  const renderers = { dashboard: renderDashboard, farms: renderFarms, visits: renderVisits, animals: renderAnimals, analysis: renderAnalysis, backup: renderBackup };
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


// V10.3 — Module Analyse testable
const analysisParameters = [
  { key: 'nec', label: 'NEC', short: 'NEC', step: '0.25', group: 'Physique' },
  { key: 'urineColor', label: 'Couleur urine', short: 'Coul.', step: '1', min: '1', max: '5', group: 'Urines' },
  { key: 'urinePH', label: 'pH urine', short: 'pH U', step: '0.01', group: 'Urines' },
  { key: 'urineRedox', label: 'Redox urine', short: 'Redox U', step: '1', group: 'Urines' },
  { key: 'urineBrix', label: 'Brix urine (%)', short: 'Brix U', step: '0.1', group: 'Urines' },
  { key: 'urineDensity', label: 'Densité urine', short: 'Densité', step: '1', group: 'Urines' },
  { key: 'glucose', label: 'Glycémie', short: 'Gly', step: '0.1', group: 'Sang' },
  { key: 'boh', label: 'BOH', short: 'BOH', step: '0.01', group: 'Sang' },
  { key: 'bloodPH', label: 'pH sanguin', short: 'pH S', step: '0.01', group: 'Sang' },
  { key: 'urea', label: 'Urémie', short: 'Urée', step: '0.01', group: 'Sang' },
  { key: 'fecesPH', label: 'pH bouses', short: 'pH B', step: '0.01', group: 'Bouses' },
  { key: 'fecesRedox', label: 'Redox bouses', short: 'Redox B', step: '1', group: 'Bouses' }
];

function numericValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function thresholdFor(subject, key) {
  const mapped = CATEGORY_RULE_MAP[subject.category];
  return mapped ? THRESHOLDS[mapped]?.[key] || null : null;
}

function classifyValue(value, rule) {
  const number = numericValue(value);
  if (number === null) return { status: 'empty', label: 'Non mesuré' };
  if (!rule) return { status: 'pending', label: 'Référence indisponible' };
  const { redLow, yellowLow, greenLow, greenHigh, yellowHigh, redHigh, labels = {} } = rule;
  if (redLow !== null && number <= redLow) return { status: 'red-low', label: labels.redLow || 'Très bas' };
  if (greenLow !== null && number < greenLow) return { status: 'yellow-low', label: labels.yellowLow || 'Bas' };
  if (greenHigh !== null && number <= greenHigh && (greenLow === null || number >= greenLow)) return { status: 'green', label: labels.green || 'Référence' };
  if (redHigh !== null && number >= redHigh) return { status: 'red-high', label: labels.redHigh || 'Très haut' };
  if (greenHigh !== null && number > greenHigh) return { status: 'yellow-high', label: labels.yellowHigh || 'Haut' };
  if (greenLow !== null && number >= greenLow) return { status: 'green', label: labels.green || 'Référence' };
  return { status: 'pending', label: 'À interpréter' };
}

function referenceText(rule) {
  if (!rule) return 'Pas de seuil validé pour cette catégorie';
  return rule.labels?.green || 'Plage de référence disponible';
}

function statusSeverity(status) {
  return { 'red-low': 3, 'red-high': 3, 'yellow-low': 2, 'yellow-high': 2, pending: 1, green: 0, empty: 0 }[status] ?? 0;
}

function analysisCell(subject, parameter) {
  const data = subject.measurements.analysis || {};
  const value = data[parameter.key] ?? '';
  const rule = thresholdFor(subject, parameter.key);
  const result = subject.category && subject.category !== 'Non classé' ? classifyValue(value, rule) : (value === '' ? {status:'empty',label:'Non mesuré'} : {status:'unclassified',label:'Classer le sujet'});
  return `<td class="analysis-value-cell ${result.status}" title="${escapeHtml(result.label)} · ${escapeHtml(referenceText(rule))}">
    <input class="analysis-input" data-subject-id="${subject.id}" data-param="${parameter.key}" type="number" inputmode="decimal" step="${parameter.step}" ${parameter.min ? `min="${parameter.min}"` : ''} ${parameter.max ? `max="${parameter.max}"` : ''} value="${escapeHtml(value)}" aria-label="${escapeHtml(parameter.label)} — ${escapeHtml(subject.tag || 'Sujet')}" />
    <small>${escapeHtml(result.label)}</small>
  </td>`;
}

function categoryAnalysis(visit) {
  const classified = (visit.subjects || []).filter(subject => subject.category && subject.category !== 'Non classé');
  const groups = new Map();
  classified.forEach(subject => {
    if (!groups.has(subject.category)) groups.set(subject.category, []);
    groups.get(subject.category).push(subject);
  });
  return [...groups.entries()].map(([category, subjects]) => {
    const parameterResults = analysisParameters.map(parameter => {
      const measured = subjects.map(subject => {
        const value = numericValue(subject.measurements.analysis?.[parameter.key]);
        const rule = thresholdFor(subject, parameter.key);
        return value === null ? null : { value, result: classifyValue(value, rule), rule };
      }).filter(Boolean);
      if (!measured.length) return null;
      const average = measured.reduce((sum, item) => sum + item.value, 0) / measured.length;
      const worst = measured.slice().sort((a,b) => statusSeverity(b.result.status) - statusSeverity(a.result.status))[0];
      const counts = measured.reduce((acc,item) => { acc[item.result.status]=(acc[item.result.status]||0)+1; return acc; },{});
      return { parameter, measured, average, worst, counts, rule: measured[0].rule };
    }).filter(Boolean);
    return { category, subjects, parameterResults };
  });
}

function interpretationItems(group) {
  const byKey = Object.fromEntries(group.parameterResults.map(item => [item.parameter.key, item]));
  const items = [];
  const abnormal = item => item && statusSeverity(item.worst.result.status) >= 2;
  const high = item => item && ['yellow-high','red-high'].includes(item.worst.result.status);
  const low = item => item && ['yellow-low','red-low'].includes(item.worst.result.status);
  if (high(byKey.urineDensity) || high(byKey.urineColor)) items.push({ level:'warning', title:'Hydratation à vérifier', text:'La concentration ou la couleur des urines sort de la plage attendue. Vérifier l’accès à l’eau, les débits, la concurrence et le contexte de prélèvement.' });
  if (abnormal(byKey.urinePH)) items.push({ level:'warning', title:'Équilibre urinaire à investiguer', text:'Le pH urinaire s’écarte de la référence de cette catégorie. Mettre ce résultat en regard de la ration, de la minéralisation et du stade physiologique.' });
  if (high(byKey.boh) || low(byKey.glucose)) items.push({ level:'danger', title:'Équilibre énergétique à investiguer', text:'Le profil BOH/glycémie comporte un ou plusieurs écarts. Vérifier l’ingestion, la densité énergétique, les transitions et l’état corporel.' });
  if (abnormal(byKey.urea)) items.push({ level:'warning', title:'Équilibre azoté à vérifier', text:'L’urémie s’écarte de la plage attendue. Croiser avec la ration, les apports azotés, l’énergie disponible et l’hydratation.' });
  if (abnormal(byKey.fecesPH) || abnormal(byKey.fecesRedox)) items.push({ level:'warning', title:'Digestion / fermentations à vérifier', text:'Les mesures sur les bouses suggèrent de contrôler la vitesse de transit, la fibrosité, les transitions et la valorisation de la ration.' });
  if (abnormal(byKey.nec)) items.push({ level:'warning', title:'État corporel à surveiller', text:'La NEC comporte un écart par rapport à la catégorie. Examiner la dynamique d’état corporel et pas uniquement la valeur ponctuelle.' });
  if (!items.length && group.parameterResults.length) items.push({ level:'good', title:'Profil mesuré globalement dans les repères', text:'Les valeurs renseignées sont majoritairement dans les plages de référence utilisées. Cette lecture reste à confronter aux observations et aux autres volets de l’audit.' });
  return items;
}

function renderAnalysisSummary(visit) {
  const groups = categoryAnalysis(visit);
  const unclassified = (visit.subjects || []).filter(subject => !subject.category || subject.category === 'Non classé');
  if (!groups.length) return `<div class="empty">Aucun sujet classé avec des valeurs mesurées. Classez les sujets dans l’onglet Animaux, puis renseignez quelques valeurs ci-dessus.</div>`;
  return `<div class="analysis-summary-groups">${groups.map(group => {
    const interpretations = interpretationItems(group);
    return `<article class="card analysis-category-card">
      <div class="section-title"><div><h3>${escapeHtml(group.category)}</h3><span class="muted">${group.subjects.length} sujet(s)</span></div><span class="analysis-category-score">${group.parameterResults.length} paramètre(s) mesuré(s)</span></div>
      <div class="analysis-kpis">${group.parameterResults.map(item => `<div class="analysis-kpi ${item.worst.result.status}"><span>${escapeHtml(item.parameter.label)}</span><strong>${item.average.toLocaleString('fr-FR',{maximumFractionDigits:2})}</strong><small>${item.measured.length} mesure(s) · réf. ${escapeHtml(referenceText(item.rule))}</small></div>`).join('')}</div>
      <div class="analysis-interpretations">${interpretations.map(item => `<div class="analysis-message ${item.level}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></div>`).join('')}</div>
      <div class="field"><label>Conclusion du technicien — ${escapeHtml(group.category)}</label><textarea data-analysis-conclusion="${escapeHtml(group.category)}" placeholder="Valider, nuancer ou compléter la synthèse automatique…">${escapeHtml(visit.analysisConclusions?.[group.category] || '')}</textarea></div>
    </article>`;
  }).join('')}</div>${unclassified.length ? `<div class="notice warning" style="margin-top:14px"><strong>${unclassified.length} sujet(s) non classé(s)</strong> : leurs valeurs sont conservées mais ne reçoivent pas de couleur ni d’interprétation catégorielle.</div>` : ''}`;
}

function renderAnalysis() {
  const visits = db.visits.slice().sort((a,b) => (b.date || '').localeCompare(a.date || ''));
  if (!activeAnalysisVisitId && visits.length) activeAnalysisVisitId = visits[0].id;
  const visit = db.visits.find(v => v.id === activeAnalysisVisitId);
  visit?.subjects?.forEach(subject => { subject.measurements = subject.measurements && typeof subject.measurements === 'object' ? subject.measurements : {}; subject.measurements.analysis = subject.measurements.analysis && typeof subject.measurements.analysis === 'object' ? subject.measurements.analysis : {}; });
  app.innerHTML = `
    <div class="section-title"><div><h2>Analyse des mesures</h2><div class="muted">Prototype testable basé sur les seuils du classeur V13. Aide à l’interprétation, sans valeur diagnostique.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
    <section class="card analysis-toolbar">
      <div class="field no-margin"><label for="analysis-visit-select">Visite analysée</label><select id="analysis-visit-select"><option value="">Sélectionner une visite…</option>${visits.map(v => `<option value="${v.id}" ${v.id === activeAnalysisVisitId ? 'selected' : ''}>${escapeHtml(visitLabel(v))}</option>`).join('')}</select></div>
      ${visit ? `<div class="actions"><button class="btn" id="analysis-demo">Charger un jeu d’essai</button><button class="btn secondary" id="analysis-clear">Effacer les valeurs d’analyse</button></div>` : ''}
    </section>
    ${!visit ? `<div class="empty" style="margin-top:16px">Créez ou sélectionnez une visite.</div>` : !visit.subjects?.length ? `<section class="card" style="margin-top:16px"><div class="empty">Cette visite ne contient aucun sujet. Ajoutez des animaux avant de tester l’analyse.</div></section>` : `
      <section class="card" style="margin-top:16px">
        <div class="section-title"><div><h3>Données de test / mesures clés</h3><span class="muted">Chaque cellule est enregistrée immédiatement. Gris = sujet non classé ou référence absente.</span></div><span class="analysis-legend"><i class="green"></i> Référence <i class="yellow"></i> Vigilance <i class="red"></i> Écart important <i class="grey"></i> En attente</span></div>
        <div class="table-wrap analysis-table-wrap"><table class="analysis-table"><thead><tr><th class="sticky-col">Sujet</th><th class="sticky-col-2">Catégorie</th>${analysisParameters.map(p => `<th title="${escapeHtml(p.label)}">${escapeHtml(p.short)}</th>`).join('')}</tr></thead><tbody>${visit.subjects.map(subject => `<tr><td class="sticky-col"><strong>${escapeHtml(subject.tag || 'Sujet')}</strong><br><small>${escapeHtml(subject.location || '')}</small></td><td class="sticky-col-2"><span class="badge ${subject.category && subject.category !== 'Non classé' ? 'complete':'unclassified'}">${escapeHtml(subject.category || 'Non classé')}</span></td>${analysisParameters.map(p => analysisCell(subject,p)).join('')}</tr>`).join('')}</tbody></table></div>
      </section>
      <section style="margin-top:16px"><div class="section-title"><h2>Synthèse par catégorie</h2><span class="muted">Moyennes, écarts et premières pistes à confirmer</span></div><div id="analysis-summary">${renderAnalysisSummary(visit)}</div></section>`}`;

  document.getElementById('analysis-visit-select')?.addEventListener('change', event => {
    activeAnalysisVisitId = event.target.value;
    localStorage.setItem('audit-bovin-active-analysis-visit', activeAnalysisVisitId);
    renderAnalysis();
  });
  app.querySelectorAll('.analysis-input').forEach(input => {
    const persist = () => {
      const subject = visit.subjects.find(item => item.id === input.dataset.subjectId);
      if (!subject) return;
      subject.measurements.analysis = subject.measurements.analysis || {};
      subject.measurements.analysis[input.dataset.param] = input.value;
      subject.updatedAt = new Date().toISOString(); visit.updatedAt = new Date().toISOString();
      saveDatabase(db);
      const parameter = analysisParameters.find(item => item.key === input.dataset.param);
      const cell = input.closest('.analysis-value-cell');
      const result = subject.category && subject.category !== 'Non classé' ? classifyValue(input.value, thresholdFor(subject, input.dataset.param)) : (input.value === '' ? {status:'empty',label:'Non mesuré'} : {status:'unclassified',label:'Classer le sujet'});
      cell.className = `analysis-value-cell ${result.status}`;
      cell.querySelector('small').textContent = result.label;
      document.getElementById('analysis-summary').innerHTML = renderAnalysisSummary(visit);
      bindAnalysisConclusions(visit);
    };
    input.addEventListener('input', persist);
    input.addEventListener('change', persist);
  });
  document.getElementById('analysis-demo')?.addEventListener('click', () => {
    if (!confirm('Charger des valeurs d’essai dans cette visite ? Les valeurs d’analyse actuelles seront remplacées.')) return;
    const demoCategories = ['Fraîche vêlée','Pic de lactation','Préparation vêlage','Fin lactation'];
    visit.subjects.forEach((subject,index) => {
      if (!subject.category || subject.category === 'Non classé') subject.category = demoCategories[index % demoCategories.length];
      const alert = index % 3 === 1;
      subject.measurements.analysis = {
        nec: alert ? '2' : (subject.category === 'Pic de lactation' ? '2.25' : '3.25'), urineColor: alert ? '4' : '2',
        urinePH: subject.category === 'Fin lactation' ? (alert ? '7.8':'7.2') : (alert ? '8.6':'8.0'), urineRedox: alert ? '12':'-10',
        urineBrix: alert ? '8':'4', urineDensity: alert ? '1036':'1020', glucose: alert ? '39':'52', boh: alert ? '1.5':'0.5',
        bloodPH: alert ? '7.5':'7.4', urea: alert ? '0.34':'0.25', fecesPH: alert ? '6.2':'6.65', fecesRedox: alert ? '-145':'-205'
      };
    });
    addJournal(visit, 'Jeu de données d’essai chargé dans le module Analyse.'); saveDatabase(db); showToast('Jeu d’essai chargé.'); renderAnalysis();
  });
  document.getElementById('analysis-clear')?.addEventListener('click', () => {
    if (!confirm('Effacer toutes les valeurs du module Analyse pour cette visite ?')) return;
    visit.subjects.forEach(subject => { subject.measurements.analysis = {}; });
    visit.analysisConclusions = {}; addJournal(visit, 'Valeurs du module Analyse effacées.'); saveDatabase(db); renderAnalysis();
  });
  bindAnalysisConclusions(visit);
}

function bindAnalysisConclusions(visit) {
  app.querySelectorAll('[data-analysis-conclusion]').forEach(field => field.addEventListener('input', () => {
    visit.analysisConclusions = visit.analysisConclusions || {};
    visit.analysisConclusions[field.dataset.analysisConclusion] = field.value;
    visit.updatedAt = new Date().toISOString(); saveDatabase(db);
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
