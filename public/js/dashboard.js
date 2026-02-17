const user = JSON.parse(window.localStorage.getItem('prelab_user') || '{}');

async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  document.getElementById('user-email').textContent = authUser.email;
  const preferredName =
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.name ||
    (authUser.email ? authUser.email.split('@')[0] : 'User');
  const knownUsers = JSON.parse(window.localStorage.getItem('prelab_known_users') || '[]');
  const isReturningUser = Array.isArray(knownUsers) && knownUsers.includes(authUser.id);
  document.getElementById('welcome-title').textContent = isReturningUser
    ? `Welcome Back, ${preferredName}!`
    : `Welcome, ${preferredName}!`;

  if (!isReturningUser) {
    const nextKnownUsers = Array.isArray(knownUsers) ? [...knownUsers, authUser.id] : [authUser.id];
    window.localStorage.setItem('prelab_known_users', JSON.stringify(nextKnownUsers));
  }
  await loadModules(authUser.id);
}

async function loadModules(userId) {
  const container = document.getElementById('module-list');
  container.innerHTML = '';

  try {
    const [modulesData, resultsData] = await Promise.all([
      window.api.get(`/modules?userId=${encodeURIComponent(userId)}`),
      window.api.get(`/results?userId=${encodeURIComponent(userId)}`)
    ]);
    const modules = modulesData.modules || [];
    const results = resultsData.results || [];
    if (!modules.length) {
      container.innerHTML = '<p>No modules yet. Create your first one.</p>';
      return;
    }

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
      const item = document.createElement('article');
      item.className = 'module-item';
      item.innerHTML = `
        <h3>${module.title}</h3>
        <p class="module-meta">Subject: ${module.subjects?.name || 'General'} | Status: ${module.status}</p>
        ${scoreText ? `<p class="module-score">Total Score: <strong>${scoreText}</strong></p>` : ''}
        <div class="module-actions">
          <button class="start-btn" data-action="start" data-id="${module.id}">Start</button>
          ${
            latestResult
              ? `<button class="summary-btn" data-action="summary" data-result-id="${latestResult.resultId}">View Summary</button>`
              : ''
          }
          <button class="del-btn" data-action="delete" data-id="${module.id}">Delete</button>
        </div>
      `;
      container.appendChild(item);
    }

    container.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const moduleId = btn.dataset.id;
        const action = btn.dataset.action;

        if (action === 'delete') {
          await window.api.del(`/modules/${moduleId}`);
          await loadModules(userId);
          return;
        }

        if (action === 'summary') {
          const resultId = btn.dataset.resultId;
          const resultPayload = await window.api.get(`/results/${resultId}`);
          window.localStorage.setItem('prelab_result', JSON.stringify(resultPayload.result));
          window.location.href = '/pages/feedback.html';
          return;
        }

        const details = await window.api.get(`/modules/${moduleId}`);
        window.localStorage.setItem('prelab_module', JSON.stringify(details.module));
        window.location.href = '/pages/study.html';
      });
    });
  } catch (error) {
    container.innerHTML = `<p>${error.message}</p>`;
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
  const indicator = document.getElementById('file-indicator');
  const submitBtn = document.getElementById('create-module-btn');
  if (!indicator) return;

  if (file) {
    indicator.classList.add('attached');
    indicator.textContent = 'File attached';
    if (submitBtn) submitBtn.classList.add('ready');
    return;
  }

  indicator.classList.remove('attached');
  indicator.textContent = 'No file selected';
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
    materialText: document.getElementById('material-text').value.trim()
  };
  const fileInput = document.getElementById('material-file');
  const selectedFile = fileInput.files?.[0] || null;

  if (!payload.materialText && !selectedFile) {
    message.textContent = 'Add study material by uploading PDF/DOCX or pasting text.';
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
    window.localStorage.setItem('prelab_module', JSON.stringify(data.module));
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

bootstrap();

