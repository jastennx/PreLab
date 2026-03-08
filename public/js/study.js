const MAX_QUIZ_GUIDANCE_LENGTH = 600;
const MIN_QUESTION_COUNT = 1;
const MAX_QUESTION_COUNT = 100;
const CHAT_LOADING_SKELETON = `
  <div class="skeleton-grid loading-shell">
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

  const module = await resolveActiveModule(authUser.id);
  if (!module.id) {
    await window.prelabDialog.alert('Select a module first from dashboard.', {
      title: 'Module Required',
      icon: 'warning'
    });
    goTo('/pages/dashboard');
    return;
  }

  document.getElementById('module-title').textContent = module.title;
  document.getElementById('subject-name').textContent = `Subject: ${module.subjects?.name || 'General'}`;
  setupVisibilityToggle(module, authUser.id);
  setupQuizGuidanceInput(module.id);
  setupQuestionCountInput();
  setupTimerToggle();
  await loadChat(authUser.id, module.id);
}

async function resolveActiveModule(userId) {
  const params = new URLSearchParams(window.location.search || '');
  const moduleId = String(params.get('moduleId') || '').trim();
  const cached = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');

  if (!moduleId) return cached;
  if (cached.id === moduleId) return cached;

  try {
    const details = await window.api.get(
      `/modules/${encodeURIComponent(moduleId)}`
    );
    if (details?.module?.id) {
      window.localStorage.setItem('prelab_module', JSON.stringify(details.module));
      return details.module;
    }
  } catch (_error) {
  }

  window.localStorage.removeItem('prelab_module');
  return {};
}

function quizGuidanceStorageKey(moduleId) {
  return `prelab_quiz_guidance_${moduleId}`;
}

function sanitizeQuizGuidance(value) {
  return String(value || '').slice(0, MAX_QUIZ_GUIDANCE_LENGTH);
}

function sanitizeQuestionCount(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(MAX_QUESTION_COUNT, Math.max(MIN_QUESTION_COUNT, parsed));
}

function setupVisibilityToggle(module, userId) {
  const privateBtn = document.getElementById('vis-private-btn');
  const publicBtn = document.getElementById('vis-public-btn');
  const hint = document.getElementById('vis-hint');
  if (!privateBtn || !publicBtn || !hint) return;

  /* Only module owner can toggle visibility */
  if (module.user_id !== userId) {
    privateBtn.closest('.vis-toggle-row')?.remove();
    return;
  }

  async function setVisibility(vis) {
    const nextIsPublic = vis === 'public';
    const previousIsPublic = module.is_public === true;
    if (nextIsPublic === previousIsPublic) return;

    privateBtn.disabled = true;
    publicBtn.disabled = true;
    try {
      if (nextIsPublic) {
        const cats = await window.api.get('/modules/categories');
        const categoryList = cats.categories || [];
        const catHtml = categoryList.map(c => `<option value="${c}">${c}</option>`).join('');
        const confirmed = await window.prelabDialog.confirm(
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
        if (!confirmed) return;
        const selectedCat = document.getElementById('swal-category')?.value || '';
        if (!selectedCat) {
          await window.prelabDialog.alert('Please select a category to publish.', { title: 'Category Required', icon: 'warning' });
          return;
        }
        await window.api.patch(
          `/modules/${encodeURIComponent(module.id)}/visibility`,
          { userId, isPublic: true, category: selectedCat }
        );
        module.category = selectedCat;
      } else {
        await window.api.patch(
          `/modules/${encodeURIComponent(module.id)}/visibility`,
          { userId, isPublic: false }
        );
      }
      module.is_public = nextIsPublic;
      window.localStorage.setItem('prelab_module', JSON.stringify(module));
    } catch (_error) {
      await window.prelabDialog.alert('Failed to update visibility.', { title: 'Error', icon: 'error' });
    } finally {
      privateBtn.disabled = false;
      publicBtn.disabled = false;
      renderVisibility();
    }
  }

  function renderVisibility() {
    if (module.is_public === true) {
      publicBtn.classList.add('vis-btn--active');
      privateBtn.classList.remove('vis-btn--active');
      hint.textContent = 'This module will appear in the public community library.';
      return;
    }
    privateBtn.classList.add('vis-btn--active');
    publicBtn.classList.remove('vis-btn--active');
    hint.textContent = 'Only you can see this module.';
  }

  privateBtn.addEventListener('click', () => setVisibility('private'));
  publicBtn.addEventListener('click', () => setVisibility('public'));
  renderVisibility();
}

function setupQuestionCountInput() {
  const el = document.getElementById('question-count');
  if (!el) return;

  el.value = String(sanitizeQuestionCount(el.value));
  el.addEventListener('input', () => {
    const raw = String(el.value || '').trim();
    if (!raw) return;
    el.value = String(sanitizeQuestionCount(raw));
  });

  el.addEventListener('blur', () => {
    el.value = String(sanitizeQuestionCount(el.value));
  });
}

function setupTimerToggle() {
  const toggle = document.getElementById('timer-toggle');
  const secondsField = document.getElementById('timer-seconds-field');
  if (!toggle || !secondsField) return;

  toggle.addEventListener('change', () => {
    secondsField.style.display = toggle.checked ? '' : 'none';
  });
}

function setupQuizGuidanceInput(moduleId) {
  const el = document.getElementById('quiz-guidance');
  if (!el || !moduleId) return;

  const key = quizGuidanceStorageKey(moduleId);
  const savedValue = sanitizeQuizGuidance(window.localStorage.getItem(key) || '');
  el.value = savedValue;

  el.addEventListener('input', () => {
    const normalized = sanitizeQuizGuidance(el.value);
    if (normalized !== el.value) {
      el.value = normalized;
    }
    window.localStorage.setItem(key, normalized);
  });
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function renderExplanation(data) {
  const normalized = normalizeExplanationPayload(data);
  const summary = document.getElementById('summary');
  const hint = document.getElementById('explanation-hint');
  const card = document.getElementById('explanation-card');
  summary.textContent = normalized.summary || 'No summary generated yet.';
  hint.textContent = normalized.summary ? '' : 'No explanation generated yet.';
  card.classList.remove('compact', 'loading');
  card.classList.add('ready');

  const points = document.getElementById('key-points');
  points.innerHTML = '';
  for (const item of normalized.key_points || []) {
    const li = document.createElement('li');
    li.textContent = item;
    points.appendChild(li);
  }

  const tips = document.getElementById('study-tips');
  tips.innerHTML = '';
  for (const item of normalized.study_tips || []) {
    const li = document.createElement('li');
    li.textContent = item;
    tips.appendChild(li);
  }
}

function normalizeExplanationPayload(data) {
  if (!data || typeof data !== 'object') {
    return { summary: '', key_points: [], study_tips: [] };
  }

  if (typeof data.summary === 'string') {
    const raw = data.summary.trim();
    if (raw.startsWith('{') && raw.includes('"summary"')) {
      try {
        const parsed = JSON.parse(raw);
        return {
          summary: normalizeText(parsed.summary || ''),
          key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(normalizeText).filter(Boolean) : [],
          study_tips: Array.isArray(parsed.study_tips) ? parsed.study_tips.map(normalizeText).filter(Boolean) : []
        };
      } catch (_error) {
        return extractExplanationFromBrokenJson(raw);
      }
    }
  }

  return {
    summary: normalizeText(data.summary || ''),
    key_points: Array.isArray(data.key_points) ? data.key_points.map(normalizeText).filter(Boolean) : [],
    study_tips: Array.isArray(data.study_tips) ? data.study_tips.map(normalizeText).filter(Boolean) : []
  };
}

function extractExplanationFromBrokenJson(raw) {
  const summaryMatch = raw.match(/"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"key_points"/i);
  const summary = summaryMatch?.[1]
    ? summaryMatch[1].replace(/\\"/g, '"').replace(/\s+/g, ' ').trim()
    : raw.slice(0, 700);

  const keyPointsBlock = raw.match(/"key_points"\s*:\s*\[([\s\S]*?)\]\s*,\s*"study_tips"/i)?.[1] || '';
  const studyTipsBlock = raw.match(/"study_tips"\s*:\s*\[([\s\S]*?)\]/i)?.[1] || '';

  const parseArrayItems = (block) => {
    if (!block) return [];
    return block
      .split(/",\s*"/)
      .map((item) => item.replace(/^"|"$/g, '').replace(/\\"/g, '"').trim())
      .filter(Boolean)
      .slice(0, 8);
  };

  return {
    summary: normalizeText(summary),
    key_points: parseArrayItems(keyPointsBlock).map(normalizeText).filter(Boolean),
    study_tips: parseArrayItems(studyTipsBlock).map(normalizeText).filter(Boolean)
  };
}

async function loadChat(userId, moduleId) {
  const box = document.getElementById('chat-messages');
  box.innerHTML = CHAT_LOADING_SKELETON;

  try {
    const data = await window.api.get(`/chat/${moduleId}?userId=${encodeURIComponent(userId)}`);
    box.innerHTML = '';
    if (!Array.isArray(data.messages) || !data.messages.length) {
      box.innerHTML = `
        <div class="empty-state">
          <strong>No chat yet</strong>
          Ask a question below and your study assistant will respond here.
        </div>
      `;
      return;
    }
    for (const msg of data.messages) {
      addMessage(msg.role, msg.content);
    }
  } catch (_error) {
    box.innerHTML = '';
    addMessage('assistant', 'Chat history is unavailable right now. You can still ask a new question.');
  }
}

function addMessage(role, content) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'assistant') {
    div.innerHTML = formatAssistantMessage(content);
  } else {
    div.textContent = content;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInline(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/`([^`]+)`/g, '<code class="msg-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function formatAssistantMessage(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';

  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])\s+(\d+\.\s+\*\*)/g, '$1\n$2')
    .replace(/([^\n])\s+(\d+\.\s+[A-Z])/g, '$1\n$2');

  const lines = normalized.split('\n');
  const blocks = [];
  let listType = null;
  let listItems = [];

  const flushList = () => {
    if (!listType || !listItems.length) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    blocks.push(`<${tag} class="msg-list">${listItems.join('')}</${tag}>`);
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const numbered = line.match(/^(\d+)[\.\)]\s+(.+)$/);
    const bulleted = line.match(/^[-*•]\s+(.+)$/);
    if (numbered || bulleted) {
      const nextType = numbered ? 'ol' : 'ul';
      const itemText = numbered ? numbered[2] : bulleted[1];
      if (listType && listType !== nextType) {
        flushList();
      }
      listType = nextType;
      listItems.push(`<li>${formatInline(itemText)}</li>`);
      continue;
    }

    flushList();
    blocks.push(`<p class="msg-paragraph">${formatInline(line)}</p>`);
  }

  flushList();
  return blocks.join('');
}

function setStatusText(id, text = '', isLoading = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const value = String(text || '').trim();
  el.textContent = value;
  el.classList.toggle('visible', Boolean(value));
  el.classList.toggle('loading', Boolean(value) && Boolean(isLoading));
}

function setExplanationLoading(isLoading, text = '') {
  const button = document.getElementById('generate-explanation');
  const hint = document.getElementById('explanation-hint');
  const summary = document.getElementById('summary');
  const points = document.getElementById('key-points');
  const tips = document.getElementById('study-tips');
  const card = document.getElementById('explanation-card');
  if (!button) return;

  if (isLoading) {
    button.disabled = true;
    button.textContent = 'Generating...';
    setStatusText('explanation-status', text || 'Explanation is generating. Please wait...', true);
    if (hint) hint.textContent = 'Explanation is generating. Please wait...';
    if (summary) summary.textContent = '';
    if (points) points.innerHTML = '';
    if (tips) tips.innerHTML = '';
    if (card) card.classList.add('compact', 'loading');
    return;
  }

  button.disabled = false;
  button.textContent = 'Generate Explanation';
  setStatusText('explanation-status', text || '', false);
  if (card) card.classList.remove('loading');
}

function setQuizLoading(isLoading, text = '') {
  const button = document.getElementById('start-practice');
  const questionCount = document.getElementById('question-count');
  const guidance = document.getElementById('quiz-guidance');
  if (!button) return;

  if (isLoading) {
    button.disabled = true;
    if (questionCount) questionCount.disabled = true;
    if (guidance) guidance.disabled = true;
    button.textContent = 'Creating Quiz...';
    setStatusText('quiz-status', text || 'Module is still creating your quiz. Please wait...', true);
    return;
  }

  button.disabled = false;
  if (questionCount) questionCount.disabled = false;
  if (guidance) guidance.disabled = false;
  button.textContent = 'Generate Practice Quiz';
  setStatusText('quiz-status', text || '', false);
}

function setChatLoading(isLoading, text = '') {
  const button = document.querySelector('#chat-form button[type="submit"]');
  const status = document.getElementById('chat-status');
  if (!button || !status) return;

  if (isLoading) {
    button.disabled = true;
    button.textContent = 'Sending...';
    status.textContent = text || 'Assistant is thinking...';
    status.classList.add('loading');
    return;
  }

  button.disabled = false;
  button.textContent = 'Send';
  status.textContent = text || '';
  status.classList.remove('loading');
}

document.getElementById('generate-explanation').addEventListener('click', async () => {
  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const topic = '';

  try {
    setExplanationLoading(true, 'Explanation is generating. Please wait...');
    const data = await window.api.post('/study/explain', { moduleId: module.id, topic });
    renderExplanation(data.explanation || {});
    setExplanationLoading(false, 'Explanation ready.');
  } catch (error) {
    setExplanationLoading(false, '');
    const message = String(error.message || '');
    const lowered = message.toLowerCase();
    if (
      lowered.includes('resource_exhausted') ||
      lowered.includes('quota') ||
      lowered.includes('rate limit') ||
      lowered.includes('429') ||
      lowered.includes('insufficient credits')
    ) {
      await window.prelabDialog.alert(
        'AI rate limit reached. Please wait a moment and try again.',
        {
          title: 'Quota Reached',
          icon: 'warning'
        }
      );
      return;
    }
    await window.prelabDialog.alert(message, { title: 'Request Failed', icon: 'error' });
  }
});

document.getElementById('start-practice').addEventListener('click', async () => {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const questionCountInput = document.getElementById('question-count');
  const selectedQuestionCount = sanitizeQuestionCount(questionCountInput?.value || 10);
  if (questionCountInput) {
    questionCountInput.value = String(selectedQuestionCount);
  }
  const quizGuidance = sanitizeQuizGuidance(document.getElementById('quiz-guidance')?.value || '');
  try {
    setQuizLoading(true, 'Module is still creating your quiz. Please wait...');
    /* Collect timer settings before generating */
    const timerEnabled = document.getElementById('timer-toggle')?.checked || false;
    const timerSeconds = Number(document.getElementById('timer-seconds')?.value) || 30;
    const timerPayload = timerEnabled
      ? { enabled: true, seconds: Math.max(5, Math.min(300, timerSeconds)) }
      : null;

    const data = await window.api.post('/practice/generate', {
      moduleId: module.id,
      userId: authUser.id,
      questionCount: selectedQuestionCount,
      quizGuidance,
      timer: timerPayload
    });

    if (data.warning) {
      await window.prelabDialog.alert(data.warning, { title: 'Notice', icon: 'warning' });
    }
    window.localStorage.setItem('prelab_quiz', JSON.stringify(data));
    window.localStorage.removeItem('prelab_result');

    /* Save timer settings for practice page */
    if (timerPayload) {
      window.localStorage.setItem('prelab_timer', JSON.stringify(timerPayload));
    } else {
      window.localStorage.removeItem('prelab_timer');
    }

    setQuizLoading(false, '');

    const proceed = await window.prelabDialog.confirm(
      'Your practice quiz has been generated! Would you like to start it now?',
      {
        title: 'Quiz Ready',
        icon: 'success',
        confirmButtonText: 'Start Quiz',
        cancelButtonText: 'Back to Dashboard'
      }
    );

    if (proceed) {
      const quizId = encodeURIComponent(data.quizId || '');
      const moduleId = encodeURIComponent(module.id || '');
      goTo(`/pages/practice?quizId=${quizId}&moduleId=${moduleId}`);
    } else {
      goTo('/pages/dashboard');
    }
  } catch (error) {
    setQuizLoading(false, '');
    const message = String(error.message || '');
    const lowered = message.toLowerCase();
    if (
      lowered.includes('resource_exhausted') ||
      lowered.includes('quota') ||
      lowered.includes('rate limit') ||
      lowered.includes('429') ||
      lowered.includes('insufficient credits')
    ) {
      await window.prelabDialog.alert(
        'AI rate limit reached. Please wait a moment and try again.',
        {
          title: 'Quota Reached',
          icon: 'warning'
        }
      );
      return;
    }
    await window.prelabDialog.alert(message, { title: 'Request Failed', icon: 'error' });
  }
});

document.getElementById('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  addMessage('user', text);
  input.value = '';

  try {
    setChatLoading(true, 'Assistant is thinking...');
    const chatHistory = Array.from(document.querySelectorAll('#chat-messages .msg')).map((node) => ({
      role: node.classList.contains('user') ? 'user' : 'assistant',
      content: node.textContent
    }));

    const data = await window.api.post('/chat', {
      moduleId: module.id,
      userId: authUser.id,
      message: text,
      history: chatHistory
    });

    addMessage('assistant', data.reply);
    setChatLoading(false, '');
  } catch (error) {
    setChatLoading(false, '');
    const lowered = String(error.message || '').toLowerCase();
    if (lowered.includes('quota') || lowered.includes('429') || lowered.includes('insufficient credits')) {
      addMessage('assistant', 'I could not respond because AI quota is exhausted. Please try again later.');
      return;
    }
    addMessage('assistant', `Error: ${error.message}`);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.confirmAndSignOut();
});

bootstrap();

