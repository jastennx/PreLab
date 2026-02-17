async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  if (!module.id) {
    alert('Select a module first from dashboard.');
    window.location.href = './dashboard.html';
    return;
  }

  document.getElementById('module-title').textContent = module.title;
  document.getElementById('subject-name').textContent = `Subject: ${module.subjects?.name || 'General'}`;
  await loadChat(authUser.id, module.id);
}

function renderExplanation(data) {
  const normalized = normalizeExplanationPayload(data);
  const summary = document.getElementById('summary');
  const hint = document.getElementById('explanation-hint');
  const card = document.getElementById('explanation-card');
  summary.textContent = normalized.summary || 'No summary generated yet.';
  hint.textContent = '';
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
          summary: parsed.summary || '',
          key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
          study_tips: Array.isArray(parsed.study_tips) ? parsed.study_tips : []
        };
      } catch (_error) {
        return extractExplanationFromBrokenJson(raw);
      }
    }
  }

  return {
    summary: data.summary || '',
    key_points: Array.isArray(data.key_points) ? data.key_points : [],
    study_tips: Array.isArray(data.study_tips) ? data.study_tips : []
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
    summary,
    key_points: parseArrayItems(keyPointsBlock),
    study_tips: parseArrayItems(studyTipsBlock)
  };
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

function setExplanationLoading(isLoading, text = '') {
  const button = document.getElementById('generate-explanation');
  const status = document.getElementById('explanation-status');
  if (!button || !status) return;

  if (isLoading) {
    button.disabled = true;
    button.textContent = 'Generating...';
    status.textContent = text || 'Explanation is generating. Please wait...';
    return;
  }

  button.disabled = false;
  button.textContent = 'Generate Explanation';
  status.textContent = text || '';
}

function setQuizLoading(isLoading, text = '') {
  const button = document.getElementById('start-practice');
  const status = document.getElementById('quiz-status');
  if (!button || !status) return;

  if (isLoading) {
    button.disabled = true;
    button.textContent = 'Creating Quiz...';
    status.textContent = text || 'Module is still creating your quiz. Please wait...';
    return;
  }

  button.disabled = false;
  button.textContent = 'Generate Practice Quiz';
  status.textContent = text || '';
}

function setChatLoading(isLoading, text = '') {
  const button = document.querySelector('#chat-form button[type="submit"]');
  const status = document.getElementById('chat-status');
  if (!button || !status) return;

  if (isLoading) {
    button.disabled = true;
    button.textContent = 'Sending...';
    status.textContent = text || 'Assistant is thinking...';
    return;
  }

  button.disabled = false;
  button.textContent = 'Send';
  status.textContent = text || '';
}

document.getElementById('generate-explanation').addEventListener('click', async () => {
  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const topic = document.getElementById('topic-input').value.trim();

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
      alert('AI quota/credits are exhausted. Use another OpenRouter free key/model or try again later.');
      return;
    }
    alert(message);
  }
});

document.getElementById('start-practice').addEventListener('click', async () => {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const selectedQuestionCount = Number(document.getElementById('question-count').value || 10);
  try {
    setQuizLoading(true, 'Module is still creating your quiz. Please wait...');
    const data = await window.api.post('/practice/generate', {
      moduleId: module.id,
      userId: authUser.id,
      questionCount: selectedQuestionCount
    });

    if (data.warning) {
      alert(data.warning);
    }
    window.localStorage.setItem('prelab_quiz', JSON.stringify(data));
    setQuizLoading(false, '');
    window.location.href = './practice.html';
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
      alert('AI quota/credits are exhausted. Use another OpenRouter free key/model or try again later.');
      return;
    }
    alert(message);
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
  await window.prelabAuth.signOut();
  window.location.href = './home.html';
});

bootstrap();
