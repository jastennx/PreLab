const user = JSON.parse(window.localStorage.getItem('prelab_user') || '{}');
let currentVisibility = 'private';

const MODULE_LOADING_SKELETON = `
  <div class="skeleton-grid loading-shell">
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  </div>
`;

function goTo(url, replace = false) {
  if (window.prelabNavigate) {
    window.prelabNavigate(url, { replace });
    return;
  }
  if (replace) {
    window.location.replace(url);
    return;
  }
  window.location.href = url;
}

async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const preferredName =
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.name ||
    (authUser.email ? authUser.email.split('@')[0] : 'User');
  document.getElementById('user-email').textContent = preferredName;

  /* Show saved profile picture in topbar avatar */
  const avatarEl = document.getElementById('user-avatar');
  const savedAvatar = localStorage.getItem('prelab_avatar');
  if (savedAvatar && avatarEl) {
    avatarEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = savedAvatar;
    img.alt = 'Avatar';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
    avatarEl.appendChild(img);
  } else if (avatarEl) {
    avatarEl.textContent = preferredName.charAt(0).toUpperCase();
  }

  const knownUsers = JSON.parse(window.localStorage.getItem('prelab_known_users') || '[]');
  const isReturningUser = Array.isArray(knownUsers) && knownUsers.includes(authUser.id);
  document.getElementById('welcome-title').textContent = isReturningUser
    ? `Welcome Back, ${preferredName}!`
    : `Hello, ${preferredName}!`;

  if (!isReturningUser) {
    const nextKnownUsers = Array.isArray(knownUsers) ? [...knownUsers, authUser.id] : [authUser.id];
    window.localStorage.setItem('prelab_known_users', JSON.stringify(nextKnownUsers));
  }

  setupVisibilityToggle();
  loadCategories();
  await loadModules(authUser.id);
  initCommunitySection(authUser.id);
}

async function loadCategories() {
  try {
    const data = await window.api.get('/modules/categories');
    const select = document.getElementById('module-category');
    if (!select || !data.categories) return;
    for (const cat of data.categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    }
  } catch (_e) { /* categories will just be empty */ }
}

function setupVisibilityToggle() {
  const privateBtn = document.getElementById('vis-private-btn');
  const publicBtn = document.getElementById('vis-public-btn');
  const hint = document.getElementById('vis-hint');
  const categoryField = document.getElementById('category-field');

  function setVisibility(vis) {
    currentVisibility = vis;
    if (vis === 'public') {
      publicBtn.classList.add('vis-btn--active');
      privateBtn.classList.remove('vis-btn--active');
      hint.textContent = 'This module will appear in the public community library.';
      categoryField.style.display = '';
    } else {
      privateBtn.classList.add('vis-btn--active');
      publicBtn.classList.remove('vis-btn--active');
      hint.textContent = 'Only you can see this module.';
      categoryField.style.display = 'none';
    }
  }

  privateBtn.addEventListener('click', () => setVisibility('private'));
  publicBtn.addEventListener('click', () => setVisibility('public'));
}

async function loadModules(userId) {
  const container = document.getElementById('module-list');
  container.innerHTML = MODULE_LOADING_SKELETON;

  try {
    const [modulesData, resultsData] = await Promise.all([
      window.api.get(`/modules?userId=${encodeURIComponent(userId)}`),
      window.api.get(`/results?userId=${encodeURIComponent(userId)}`)
    ]);
    const modules = modulesData.modules || [];
    const results = resultsData.results || [];
    if (!modules.length) {
      container.innerHTML = `
        <div class="empty-state">
          <strong>No modules yet</strong>
          Start by creating your first study module to unlock quizzes and feedback.
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    const latestResultByModule = new Map();
    for (const item of results) {
      if (!item?.module_id) continue;
      if (!latestResultByModule.has(item.module_id)) {
        latestResultByModule.set(item.module_id, {
          resultId: item.id,
          correct: Number(item.correct_count || 0),
          total: Number(item.total_questions || 0)
        });
      }
    }

    for (const module of modules) {
      const latestResult = latestResultByModule.get(module.id);
      const scoreText = latestResult ? `${latestResult.correct}/${latestResult.total}` : null;
      const isPublic = module.is_public;
      const visBadge = isPublic
        ? `<span class="vis-badge vis-badge--public" title="Public · ${module.category || 'No category'}">
             <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
             Public
           </span>`
        : `<span class="vis-badge vis-badge--private" title="Private">
             <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
             Private
           </span>`;
      const item = document.createElement('article');
      item.className = 'module-item';
      const statusLabel = module.status === 'ready' ? 'Module Uploaded' : module.status;
      item.innerHTML = `
        <div class="module-head-row">
          <h3>${module.title}</h3>
          ${visBadge}
        </div>
        <p class="module-meta">Subject: ${module.subjects?.name || 'General'} | Status: ${statusLabel} | ${timeAgo(module.created_at)}</p>
        ${isPublic && module.category ? `<p class="module-category-tag">${module.category}</p>` : ''}
        ${scoreText ? `<p class="module-score">Last Score: <strong>${scoreText}</strong></p>` : `<p class="module-meta" style="font-style:italic">No quiz taken yet — start a practice quiz!</p>`}
        <div class="module-actions">
          <button class="start-btn" data-action="start" data-id="${module.id}">Start</button>
          ${
            latestResult
              ? `<button class="summary-btn" data-action="summary" data-result-id="${latestResult.resultId}">View Summary</button>`
              : ''
          }
          <button class="vis-toggle-btn" data-action="toggle-vis" data-id="${module.id}" data-public="${isPublic}">
            ${isPublic ? 'Make Private' : 'Make Public'}
          </button>
          <button class="del-btn" data-action="delete" data-id="${module.id}">Delete</button>
        </div>
      `;
      container.appendChild(item);
    }

    container.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const moduleId = btn.dataset.id;
        const action = btn.dataset.action;
        btn.disabled = true;

        try {
          if (action === 'delete') {
            const shouldDelete = await window.prelabDialog.confirm(
              'Delete this module and all related quizzes/results?',
              {
                title: 'Delete Module',
                icon: 'warning',
                confirmButtonText: 'Delete'
              }
            );
            if (!shouldDelete) return;
            await window.api.del(`/modules/${moduleId}?userId=${encodeURIComponent(userId)}`);
            await loadModules(userId);
            return;
          }

          if (action === 'toggle-vis') {
            const isCurrentlyPublic = btn.dataset.public === 'true';
            if (isCurrentlyPublic) {
              await window.api.patch(`/modules/${moduleId}/visibility`, {
                userId,
                isPublic: false
              });
              await loadModules(userId);
            } else {
              const cats = await window.api.get('/modules/categories');
              const categoryList = cats.categories || [];
              const catHtml = categoryList.map(c => `<option value="${c}">${c}</option>`).join('');
              const result = await window.prelabDialog.confirm(
                `<div style="text-align:left">
                  <p style="margin-bottom:0.7rem;color:var(--ink-soft)">Choose a category for this public module:</p>
                  <select id="swal-category" style="width:100%;padding:0.55rem 0.75rem;border-radius:10px;border:1px solid var(--border);background:rgba(14,4,30,0.6);color:var(--ink);font-family:inherit;font-size:0.88rem">
                    <option value="">Select category...</option>
                    ${catHtml}
                  </select>
                </div>`,
                {
                  title: 'Make Public',
                  icon: 'info',
                  confirmButtonText: 'Publish',
                  html: true
                }
              );
              if (!result) return;
              const selectedCat = document.getElementById('swal-category')?.value || '';
              if (!selectedCat) {
                await window.prelabDialog.alert('Please select a category to publish.', { title: 'Category Required', icon: 'warning' });
                return;
              }
              await window.api.patch(`/modules/${moduleId}/visibility`, {
                userId,
                isPublic: true,
                category: selectedCat
              });
              await loadModules(userId);
            }
            return;
          }

          if (action === 'summary') {
            const resultId = btn.dataset.resultId;
            const resultPayload = await window.api.get(
              `/results/${resultId}?userId=${encodeURIComponent(userId)}`
            );
            window.localStorage.setItem('prelab_result', JSON.stringify(resultPayload.result));
            goTo(`/pages/feedback?resultId=${encodeURIComponent(resultId)}`);
            return;
          }

          const details = await window.api.get(
            `/modules/${moduleId}?userId=${encodeURIComponent(userId)}`
          );
          window.localStorage.removeItem('prelab_quiz');
          window.localStorage.removeItem('prelab_result');
          window.localStorage.setItem('prelab_module', JSON.stringify(details.module));
          goTo(`/pages/study?moduleId=${encodeURIComponent(moduleId)}`);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Could not load modules</strong>
        ${error.message}
      </div>
    `;
  }
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uploadMaterialToStorage(userId, file) {
  if (!file) return '';

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['pdf', 'docx'].includes(ext)) {
    throw new Error('Only PDF or DOCX files are allowed.');
  }

  await window.prelabAuth.init();
  const client = window.prelabAuth.client;
  if (!client) throw new Error('Supabase client config missing');

  const bucket = window.PRELAB_CONFIG.studyMaterialsBucket || 'study-materials';
  const filePath = `${userId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error } = await client.storage.from(bucket).upload(filePath, file, {
    upsert: false,
    contentType: file.type || undefined
  });

  if (error) {
    throw new Error(
      `Storage upload failed: ${error.message}. Create bucket "${bucket}" and allow authenticated uploads.`
    );
  }

  return filePath;
}

function setModuleLoading(isLoading, text = '') {
  const submitBtn = document.getElementById('create-module-btn');
  const message = document.getElementById('module-message');
  if (!submitBtn || !message) return;

  if (isLoading) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Module...';
    submitBtn.classList.remove('ready');
    message.classList.add('loading');
    message.textContent = text || 'Module is still creating. Please wait...';
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Create Module';
  message.classList.remove('loading');
  if (text) message.textContent = text;
}

function setFileAttachedState(file) {
  const zone = document.querySelector('.upload-zone');
  const iconRing = zone?.querySelector('.upload-icon-ring');
  const label = zone?.querySelector('strong');
  const hint = zone?.querySelector('.upload-hint');
  const indicator = document.getElementById('file-indicator');
  const submitBtn = document.getElementById('create-module-btn');
  if (!zone) return;

  if (file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const icon = isPdf
      ? '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
      : '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
    if (iconRing) iconRing.innerHTML = icon;
    if (label) label.textContent = file.name;
    if (hint) hint.textContent = `${ext.toUpperCase()} file selected · Click to change`;
    if (indicator) { indicator.classList.add('attached'); indicator.textContent = ext.toUpperCase(); }
    zone.classList.add('has-file');
    if (submitBtn) submitBtn.classList.add('ready');
    return;
  }

  if (iconRing) iconRing.innerHTML = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  if (label) label.textContent = 'Upload PDF or DOCX';
  if (hint) hint.textContent = 'Drag & drop or click to browse';
  if (indicator) { indicator.classList.remove('attached'); indicator.textContent = 'No file selected'; }
  zone.classList.remove('has-file');
  if (submitBtn) submitBtn.classList.remove('ready');
}

document.getElementById('module-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const message = document.getElementById('module-message');
  message.textContent = '';

  const payload = {
    userId: authUser.id,
    subjectName: document.getElementById('subject-name').value.trim(),
    moduleTitle: document.getElementById('module-title').value.trim(),
    studyGoal: document.getElementById('study-goal').value.trim(),
    materialText: document.getElementById('material-text').value.trim(),
    isPublic: currentVisibility === 'public',
    category: currentVisibility === 'public' ? document.getElementById('module-category').value : ''
  };
  const fileInput = document.getElementById('material-file');
  const selectedFile = fileInput.files?.[0] || null;

  if (!payload.materialText && !selectedFile) {
    message.textContent = 'Add study material by uploading PDF/DOCX or pasting text.';
    return;
  }

  if (payload.isPublic && !payload.category) {
    message.textContent = 'Please select a category for public modules.';
    return;
  }

  try {
    let storagePath = '';
    if (selectedFile) {
      setModuleLoading(true, 'Uploading file...');
      storagePath = await uploadMaterialToStorage(authUser.id, selectedFile);
    }

    setModuleLoading(true, 'Analyzing module...');
    const data = await window.api.post('/modules', { ...payload, storagePath });
    setModuleLoading(false, 'Module created successfully.');
    event.target.reset();
    setFileAttachedState(null);
    await loadModules(authUser.id);
    window.localStorage.removeItem('prelab_quiz');
    window.localStorage.removeItem('prelab_result');
    window.localStorage.setItem('prelab_module', JSON.stringify(data.module));

    /* Auto-fill subject & title from last created module */
    if (data.module) {
      const subjectInput = document.getElementById('subject-name');
      const titleInput = document.getElementById('module-title');
      if (subjectInput && data.module.subjects?.name) subjectInput.value = data.module.subjects.name;
      if (titleInput && data.module.title) titleInput.value = data.module.title;
    }
  } catch (error) {
    setModuleLoading(false, error.message);
  }
});

document.getElementById('material-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0] || null;
  setFileAttachedState(file);
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.confirmAndSignOut();
});

/* ═══════════════════════════════════
   COMMUNITY REVIEWERS (Dashboard)
   ═══════════════════════════════════ */
let activeCommunityCategory = '';

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

async function loadCommunityModules(userId, category) {
  const grid = document.getElementById('community-list');
  if (!grid) return;

  grid.innerHTML = MODULE_LOADING_SKELETON;

  try {
    const url = category
      ? `/modules/public?category=${encodeURIComponent(category)}`
      : '/modules/public';
    const data = await window.api.get(url);
    const modules = (data.modules || []).filter(m => m.user_id !== userId);

    if (!modules.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <strong>No community reviewers${category ? ` in ${category}` : ''}</strong>
          Public modules shared by other users will appear here.
        </div>`;
      return;
    }

    grid.innerHTML = '';
    for (const mod of modules) {
      const authorName = mod.users?.full_name || 'Anonymous';
      const initial = authorName.charAt(0).toUpperCase();
      const item = document.createElement('article');
      item.className = 'module-item community-module-item';
      item.innerHTML = `
        <div class="module-head-row">
          <h3>${mod.title}</h3>
          <span class="vis-badge vis-badge--public">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            ${mod.category || 'Public'}
          </span>
        </div>
        <p class="module-meta">Subject: ${mod.subjects?.name || 'General'} | ${timeAgo(mod.created_at)}</p>
        ${mod.study_goal ? `<p class="module-meta" style="font-style:italic">${mod.study_goal}</p>` : ''}
        <div class="cc-author-dash">
          <span class="cc-avatar-sm">${initial}</span>
          <span class="cc-name-sm">${authorName}</span>
        </div>
        <div class="module-actions">
          <button class="start-btn" data-action="start-community" data-id="${mod.id}">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Take Quiz
          </button>
          <button class="summary-btn" data-action="study-community" data-id="${mod.id}">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            Study Material
          </button>
        </div>
      `;
      grid.appendChild(item);
    }

    grid.querySelectorAll('[data-action="start-community"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const moduleId = btn.dataset.id;
        btn.disabled = true;
        try {
          /* Fetch the host's quiz for this community module */
          const quizData = await window.api.get(
            `/modules/${encodeURIComponent(moduleId)}/community-quiz`
          );
          if (!quizData.quiz || !quizData.quiz.quiz_json?.questions?.length) {
            await window.prelabDialog.alert(
              'The host hasn\u2019t created a quiz for this module yet. You can study the material instead.',
              { title: 'No Quiz Available', icon: 'info' }
            );
            return;
          }

          const details = await window.api.get(
            `/modules/${encodeURIComponent(moduleId)}?userId=${encodeURIComponent(userId)}`
          );
          window.localStorage.removeItem('prelab_result');

          /* Inherit host timer settings if present */
          const hostTimer = quizData.quiz.quiz_json?.timer;
          if (hostTimer && hostTimer.enabled) {
            window.localStorage.setItem('prelab_timer', JSON.stringify({ enabled: true, seconds: hostTimer.seconds }));
          } else {
            window.localStorage.removeItem('prelab_timer');
          }

          window.localStorage.setItem('prelab_module', JSON.stringify(details.module));
          window.localStorage.setItem('prelab_quiz', JSON.stringify({
            quizId: quizData.quiz.id,
            quiz: quizData.quiz.quiz_json
          }));
          goTo(`/pages/practice?quizId=${encodeURIComponent(quizData.quiz.id)}&moduleId=${encodeURIComponent(moduleId)}`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    grid.querySelectorAll('[data-action="study-community"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const moduleId = btn.dataset.id;
        btn.disabled = true;
        try {
          const details = await window.api.get(
            `/modules/${encodeURIComponent(moduleId)}?userId=${encodeURIComponent(userId)}`
          );
          window.localStorage.removeItem('prelab_quiz');
          window.localStorage.removeItem('prelab_result');
          window.localStorage.setItem('prelab_module', JSON.stringify(details.module));
          goTo(`/pages/study?moduleId=${encodeURIComponent(moduleId)}`);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (error) {
    grid.innerHTML = `
      <div class="empty-state">
        <strong>Could not load community reviewers</strong>
        ${error.message}
      </div>`;
  }
}

async function initCommunitySection(userId) {
  const tabsContainer = document.getElementById('community-tabs');
  if (!tabsContainer) return;

  try {
    const data = await window.api.get('/modules/categories');
    const categories = data.categories || [];
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.className = 'comm-tab';
      btn.dataset.category = cat;
      btn.textContent = cat;
      tabsContainer.appendChild(btn);
    }

    tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.comm-tab');
      if (!tab) return;
      tabsContainer.querySelectorAll('.comm-tab').forEach(t => t.classList.remove('comm-tab--active'));
      tab.classList.add('comm-tab--active');
      activeCommunityCategory = tab.dataset.category;
      loadCommunityModules(userId, activeCommunityCategory);
    });
  } catch (_e) { /* just show "All" */ }

  await loadCommunityModules(userId, '');
}

bootstrap();

