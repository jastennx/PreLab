let currentIndex = 0;
let answers = [];
let quizData = null;
let isSubmitting = false;

async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = await resolveActiveModule(authUser.id);
  const quizWrapper = await resolveActiveQuiz(authUser.id);

  if (!module.id || !quizWrapper.quizId || !quizWrapper.quiz?.questions?.length) {
    await window.prelabDialog.alert('No quiz found. Generate one from Study page.', {
      title: 'Quiz Missing',
      icon: 'warning'
    });
    const moduleQuery = module.id ? `?moduleId=${encodeURIComponent(module.id)}` : '';
    window.location.href = `/pages/study${moduleQuery}`;
    return;
  }

  quizData = quizWrapper;
  answers = new Array(quizData.quiz.questions.length).fill(null);

  document.getElementById('module-title').textContent = module.title;
  document.getElementById('total-number').textContent = String(quizData.quiz.questions.length);

  renderPager();
  renderQuestion();
}

async function resolveActiveModule(userId) {
  const params = new URLSearchParams(window.location.search || '');
  const moduleId = String(params.get('moduleId') || '').trim();
  const cached = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');

  if (!moduleId) return cached;
  if (cached.id === moduleId) return cached;

  try {
    const details = await window.api.get(
      `/modules/${encodeURIComponent(moduleId)}?userId=${encodeURIComponent(userId)}`
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

async function resolveActiveQuiz(userId) {
  const params = new URLSearchParams(window.location.search || '');
  const quizId = String(params.get('quizId') || '').trim();
  const cached = JSON.parse(window.localStorage.getItem('prelab_quiz') || '{}');

  if (!quizId) return cached;
  if (cached.quizId === quizId) return cached;

  try {
    const payload = await window.api.get(
      `/quizzes/${encodeURIComponent(quizId)}?userId=${encodeURIComponent(userId)}`
    );
    const quiz = payload?.quiz?.quiz_json;
    if (payload?.quiz?.id && quiz?.questions?.length) {
      const wrapped = { quizId: payload.quiz.id, quiz };
      window.localStorage.setItem('prelab_quiz', JSON.stringify(wrapped));
      return wrapped;
    }
  } catch (_error) {
  }

  window.localStorage.removeItem('prelab_quiz');
  return {};
}

function renderPager() {
  const pager = document.getElementById('pager');
  pager.innerHTML = '';

  quizData.quiz.questions.forEach((_q, index) => {
    const btn = document.createElement('button');
    btn.textContent = String(index + 1);

    if (index === currentIndex) btn.classList.add('active');
    if (answers[index] !== null && index !== currentIndex) btn.classList.add('done');

    btn.addEventListener('click', () => {
      if (isSubmitting) return;
      currentIndex = index;
      renderPager();
      renderQuestion();
    });

    pager.appendChild(btn);
  });
}

function renderQuestion() {
  const total = quizData.quiz.questions.length;
  const current = quizData.quiz.questions[currentIndex];

  document.getElementById('current-number').textContent = String(currentIndex + 1);
  document.getElementById('question-text').textContent = current.question;
  document.getElementById('progress-fill').style.width = `${((currentIndex + 1) / total) * 100}%`;

  const optionList = document.getElementById('option-list');
  optionList.innerHTML = '';

  current.options.forEach((option, idx) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    const optionPrefix = String.fromCharCode(65 + idx);
    btn.innerHTML = `<span class="option-prefix">${optionPrefix}.</span> ${option}`;
    if (answers[currentIndex] === idx) btn.classList.add('selected');

    btn.addEventListener('click', () => {
      if (isSubmitting) return;
      answers[currentIndex] = answers[currentIndex] === idx ? null : idx;
      renderPager();
      renderQuestion();
    });

    optionList.appendChild(btn);
  });

  const nextBtn = document.getElementById('next-btn');
  nextBtn.textContent = currentIndex + 1 === total ? 'Submit Quiz' : 'Next';
  nextBtn.disabled = isSubmitting;
}

function setSubmitLoading(isLoading, text = '') {
  isSubmitting = isLoading;
  const nextBtn = document.getElementById('next-btn');
  const status = document.getElementById('submit-status');
  const value = String(text || '').trim();

  if (isLoading) {
    nextBtn.disabled = true;
    nextBtn.textContent = 'Submitting Quiz...';
    status.textContent = value || 'Quiz is being submitted. Please wait...';
    status.classList.add('visible');
    status.classList.add('loading');
    return;
  }

  nextBtn.disabled = false;
  status.textContent = value;
  status.classList.toggle('visible', Boolean(value));
  status.classList.remove('loading');
  renderQuestion();
}

document.getElementById('next-btn').addEventListener('click', async () => {
  if (isSubmitting) return;

  const total = quizData.quiz.questions.length;

  if (currentIndex + 1 < total) {
    currentIndex += 1;
    renderPager();
    renderQuestion();
    return;
  }

  const hasBlank = answers.some((item) => item === null);
  if (hasBlank) {
    await window.prelabDialog.alert('Please answer all questions before submitting.', {
      title: 'Incomplete Answers',
      icon: 'warning'
    });
    return;
  }

  const shouldSubmit = await window.prelabDialog.confirm(
    'Are you sure you want to submit your answers? You will not be able to change them after submitting.',
    {
      title: 'Submit Quiz',
      icon: 'question',
      confirmButtonText: 'Submit',
      cancelButtonText: 'Review Answers'
    }
  );

  if (!shouldSubmit) {
    return;
  }

  const authUser = await window.requireAuthUser();
  if (!authUser) return;
  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');

  try {
    setSubmitLoading(true, 'Quiz is being submitted. Please wait...');
    const data = await window.api.post('/practice/submit', {
      quizId: quizData.quizId,
      moduleId: module.id,
      userId: authUser.id,
      answers
    });

    window.localStorage.setItem('prelab_result', JSON.stringify(data.result));
    window.localStorage.removeItem('prelab_quiz');
    setSubmitLoading(false, '');
    const resultId = encodeURIComponent(data.result?.id || '');
    const moduleId = encodeURIComponent(module.id || '');
    window.location.href = `/pages/feedback?resultId=${resultId}&moduleId=${moduleId}`;
  } catch (error) {
    setSubmitLoading(false, '');
    await window.prelabDialog.alert(error.message, { title: 'Submit Failed', icon: 'error' });
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.confirmAndSignOut();
});

bootstrap();

