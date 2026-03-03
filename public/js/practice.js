let currentIndex = 0;
let answers = [];
let quizData = null;
let isSubmitting = false;
let timerInterval = null;
let remainingSeconds = null;
let startedAtMs = Date.now();

async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const quizWrapper = JSON.parse(window.localStorage.getItem('prelab_quiz') || '{}');

  if (!module.id || !quizWrapper.quizId || !quizWrapper.quiz?.questions?.length) {
    await window.prelabDialog.alert('No quiz found. Generate one from Study page.', {
      title: 'Quiz Missing',
      icon: 'warning'
    });
    window.location.href = '/pages/study';
    return;
  }

  quizData = quizWrapper;
  answers = new Array(quizData.quiz.questions.length).fill(null);
  startedAtMs = Date.now();

  document.getElementById('module-title').textContent = module.title;
  document.getElementById('total-number').textContent = String(quizData.quiz.questions.length);

  setupModeBanner();
  renderPager();
  renderQuestion();
}

function setupModeBanner() {
  const modeEl = document.getElementById('quiz-mode-label');
  const timerEl = document.getElementById('timer-label');
  if (!modeEl || !timerEl) return;

  const mode = String(quizData?.quiz?.quiz_mode || 'practice');
  if (mode === 'review') {
    modeEl.textContent = 'Mode: Daily Review (Spaced Repetition)';
  } else if (mode === 'mock_exam') {
    modeEl.textContent = 'Mode: Timed Mock Exam';
  } else {
    modeEl.textContent = 'Mode: Practice';
  }

  const minutes = Number(quizData?.quiz?.mock_exam_minutes || 0);
  if (mode === 'mock_exam' && Number.isFinite(minutes) && minutes > 0) {
    remainingSeconds = minutes * 60;
    renderTimer();
    timerInterval = window.setInterval(async () => {
      if (isSubmitting) return;
      remainingSeconds -= 1;
      renderTimer();
      if (remainingSeconds <= 0) {
        window.clearInterval(timerInterval);
        timerInterval = null;
        await submitQuiz(true);
      }
    }, 1000);
  } else {
    timerEl.textContent = '';
  }
}

function formatTime(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderTimer() {
  const timerEl = document.getElementById('timer-label');
  if (!timerEl) return;
  timerEl.textContent = `Time Remaining: ${formatTime(remainingSeconds)}`;
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

async function submitQuiz(isForcedByTimer = false) {
  if (isSubmitting) return;

  const total = quizData.quiz.questions.length;
  if (!isForcedByTimer) {
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

    if (!shouldSubmit) return;
  } else {
    for (let i = 0; i < total; i += 1) {
      if (answers[i] === null) answers[i] = -1;
    }
  }

  const authUser = await window.requireAuthUser();
  if (!authUser) return;
  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');

  try {
    if (timerInterval) {
      window.clearInterval(timerInterval);
      timerInterval = null;
    }

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
    setSubmitLoading(true, 'Quiz is being submitted. Please wait...');
    const data = await window.api.post('/practice/submit', {
      quizId: quizData.quizId,
      moduleId: module.id,
      userId: authUser.id,
      answers,
      elapsedSeconds
    });

    window.localStorage.setItem('prelab_result', JSON.stringify(data.result));
    setSubmitLoading(false, '');
    window.location.href = '/pages/feedback';
  } catch (error) {
    setSubmitLoading(false, '');
    await window.prelabDialog.alert(error.message, { title: 'Submit Failed', icon: 'error' });
  }
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

  await submitQuiz(false);
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.confirmAndSignOut();
});

bootstrap();