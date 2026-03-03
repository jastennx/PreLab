const MAX_QUIZ_GUIDANCE_LENGTH = 600;

async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  if (!module.id) {
    await window.prelabDialog.alert('Select a module first from dashboard.', {
      title: 'Module Required',
      icon: 'warning'
    });
    window.location.href = '/pages/dashboard';
    return;
  }

  document.getElementById('module-title').textContent = module.title;
  document.getElementById('subject-name').textContent = `Subject: ${module.subjects?.name || 'General'}`;

  setupQuizGuidanceInput(module.id);
  setupQuizModeControls(module.id);
  setupPlanDeadlineDefault();

  await Promise.all([
    loadChat(authUser.id, module.id),
    loadFlashcards(authUser.id, module.id),
    loadStudyPlan(authUser.id, module.id)
  ]);
}

function quizGuidanceStorageKey(moduleId) {
  return `prelab_quiz_guidance_${moduleId}`;
}

function quizModeStorageKey(moduleId) {
  return `prelab_quiz_mode_${moduleId}`;
}

function sanitizeQuizGuidance(value) {
  return String(value || '').slice(0, MAX_QUIZ_GUIDANCE_LENGTH);
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

function setupQuizModeControls(moduleId) {
  const modeEl = document.getElementById('quiz-mode');
  const minutesEl = document.getElementById('mock-exam-minutes');
  if (!modeEl || !minutesEl) return;

  const key = quizModeStorageKey(moduleId);
  const savedMode = window.localStorage.getItem(key) || 'practice';
  modeEl.value = savedMode === 'mock_exam' ? 'mock_exam' : 'practice';

  const sync = () => {
    const isMock = modeEl.value === 'mock_exam';
    minutesEl.disabled = !isMock;
    minutesEl.style.opacity = isMock ? '1' : '0.65';
    window.localStorage.setItem(key, modeEl.value);
  };

  modeEl.addEventListener('change', sync);
  sync();
}

function setupPlanDeadlineDefault() {
  const el = document.getElementById('plan-deadline');
  if (!el || el.value) return;

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const iso = nextWeek.toISOString().slice(0, 10);
  el.value = iso;
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

function renderFlashcards(cards) {
  const list = document.getElementById('flashcard-list');
  if (!list) return;

  list.innerHTML = '';
  if (!cards.length) {
    list.innerHTML = '<p>No flashcards yet.</p>';
    return;
  }

  cards.forEach((card) => {
    const div = document.createElement('article');
    div.className = 'flashcard-item';
    div.innerHTML = `
      <h4>${card.topic || 'General'} (${card.difficulty || 'medium'})</h4>
      <p><strong>Q:</strong> ${card.front}</p>
      <p><strong>A:</strong> ${card.back}</p>
      <div class="flashcard-toolbar">
        <span>${card.is_hard ? 'Marked Hard' : 'Normal'}</span>
        <button data-id="${card.id}" data-hard="${card.is_hard ? '0' : '1'}">
          ${card.is_hard ? 'Unmark Hard' : 'Mark Hard'}
        </button>
      </div>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const authUser = await window.requireAuthUser();
      if (!authUser) return;
      const cardId = btn.dataset.id;
      const shouldHard = btn.dataset.hard === '1';
      try {
        await window.api.post(`/flashcards/${cardId}/hard`, {
          userId: authUser.id,
          isHard: shouldHard
        });
        const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
        await loadFlashcards(authUser.id, module.id);
      } catch (error) {
        await window.prelabDialog.alert(error.message, { title: 'Flashcard Update Failed', icon: 'error' });
      }
    });
  });
}

function renderStudyPlan(planRecord) {
  const list = document.getElementById('study-plan-list');
  if (!list) return;

  list.innerHTML = '';
  if (!planRecord?.plan_json) {
    list.innerHTML = '<p>No study plan yet.</p>';
    return;
  }

  const plan = planRecord.plan_json;
  const overview = document.createElement('p');
  overview.textContent = plan.overview || 'Generated study plan.';
  list.appendChild(overview);

  (plan.daily_plan || []).forEach((day) => {
    const div = document.createElement('article');
    div.className = 'plan-day';
    div.innerHTML = `<h4>${day.day}: ${day.focus}</h4><p>${(day.tasks || []).join(' | ')}</p>`;
    list.appendChild(div);
  });
}

async function loadFlashcards(userId, moduleId) {
  const status = document.getElementById('flashcard-status');
  if (!status) return;
  try {
    const data = await window.api.get(`/flashcards?userId=${encodeURIComponent(userId)}&moduleId=${encodeURIComponent(moduleId)}`);
    renderFlashcards(data.flashcards || []);
  } catch (_error) {
    renderFlashcards([]);
  }
}

async function loadStudyPlan(userId, moduleId) {
  try {
    const data = await window.api.get(`/study-plan?userId=${encodeURIComponent(userId)}&moduleId=${encodeURIComponent(moduleId)}`);
    renderStudyPlan(data.plan || null);
  } catch (_error) {
    renderStudyPlan(null);
  }
}

async function loadChat(userId, moduleId) {
  const box = document.getElementById('chat-messages');
  box.innerHTML = '';

  try {
    const data = await window.api.get(`/chat/${moduleId}?userId=${encodeURIComponent(userId)}`);
    for (const msg of data.messages) {
      addMessage(msg.role, msg.content);
    }
  } catch (_error) {
    addMessage('assistant', 'Chat history not available yet.');
  }
}

function addMessage(role, content) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = content;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
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
  const reviewButton = document.getElementById('start-daily-review');
  const questionCount = document.getElementById('question-count');
  const guidance = document.getElementById('quiz-guidance');
  const quizMode = document.getElementById('quiz-mode');
  const mockMinutes = document.getElementById('mock-exam-minutes');
  if (!button) return;

  if (isLoading) {
    button.disabled = true;
    if (reviewButton) reviewButton.disabled = true;
    if (questionCount) questionCount.disabled = true;
    if (guidance) guidance.disabled = true;
    if (quizMode) quizMode.disabled = true;
    if (mockMinutes) mockMinutes.disabled = true;
    button.textContent = 'Creating Quiz...';
    setStatusText('quiz-status', text || 'Module is still creating your quiz. Please wait...', true);
    return;
  }

  button.disabled = false;
  if (reviewButton) reviewButton.disabled = false;
  if (questionCount) questionCount.disabled = false;
  if (guidance) guidance.disabled = false;
  if (quizMode) quizMode.disabled = false;
  if (mockMinutes && quizMode?.value === 'mock_exam') mockMinutes.disabled = false;
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
  const selectedQuestionCount = Number(document.getElementById('question-count').value || 10);
  const quizGuidance = sanitizeQuizGuidance(document.getElementById('quiz-guidance')?.value || '');
  const quizMode = document.getElementById('quiz-mode')?.value || 'practice';
  const mockExamMinutes = Number(document.getElementById('mock-exam-minutes')?.value || 30);
  try {
    setQuizLoading(true, 'Module is still creating your quiz. Please wait...');
    const data = await window.api.post('/practice/generate', {
      moduleId: module.id,
      userId: authUser.id,
      questionCount: selectedQuestionCount,
      quizGuidance,
      quizMode,
      mockExamMinutes
    });

    if (data.warning) {
      await window.prelabDialog.alert(data.warning, { title: 'Notice', icon: 'warning' });
    }
    window.localStorage.setItem('prelab_quiz', JSON.stringify(data));
    setQuizLoading(false, '');
    window.location.href = '/pages/practice';
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

document.getElementById('start-daily-review').addEventListener('click', async () => {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const selectedQuestionCount = Number(document.getElementById('question-count').value || 10);

  try {
    setQuizLoading(true, 'Preparing your daily review...');
    const data = await window.api.post('/review/daily', {
      moduleId: module.id,
      userId: authUser.id,
      questionCount: selectedQuestionCount
    });

    window.localStorage.setItem('prelab_quiz', JSON.stringify(data));
    setQuizLoading(false, '');
    window.location.href = '/pages/practice';
  } catch (error) {
    setQuizLoading(false, '');
    await window.prelabDialog.alert(error.message, { title: 'Daily Review Failed', icon: 'error' });
  }
});

document.getElementById('generate-plan').addEventListener('click', async () => {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const deadline = document.getElementById('plan-deadline')?.value;
  if (!deadline) {
    await window.prelabDialog.alert('Please choose a deadline date first.', { title: 'Deadline Required', icon: 'warning' });
    return;
  }

  try {
    setStatusText('plan-status', 'Generating study plan...', true);
    await window.api.post('/study-plan/generate', {
      moduleId: module.id,
      userId: authUser.id,
      deadline
    });
    await loadStudyPlan(authUser.id, module.id);
    setStatusText('plan-status', 'Study plan ready.', false);
  } catch (error) {
    setStatusText('plan-status', '', false);
    await window.prelabDialog.alert(error.message, { title: 'Plan Generation Failed', icon: 'error' });
  }
});

document.getElementById('generate-flashcards').addEventListener('click', async () => {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  try {
    setStatusText('flashcard-status', 'Generating flashcards...', true);
    await window.api.post('/flashcards/generate', {
      moduleId: module.id,
      userId: authUser.id,
      count: 20
    });
    await loadFlashcards(authUser.id, module.id);
    setStatusText('flashcard-status', 'Flashcards ready.', false);
  } catch (error) {
    setStatusText('flashcard-status', '', false);
    await window.prelabDialog.alert(error.message, { title: 'Flashcard Generation Failed', icon: 'error' });
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