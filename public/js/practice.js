let currentIndex = 0;
let answers = [];
let quizData = null;
let isSubmitting = false;

async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const module = JSON.parse(window.localStorage.getItem('prelab_module') || '{}');
  const quizWrapper = JSON.parse(window.localStorage.getItem('prelab_quiz') || '{}');

  if (!module.id || !quizWrapper.quizId || !quizWrapper.quiz?.questions?.length) {
    alert('No quiz found. Generate one from Study page.');
    window.location.href = './study.html';
    return;
  }

  quizData = quizWrapper;
  answers = new Array(quizData.quiz.questions.length).fill(null);

  document.getElementById('module-title').textContent = module.title;
  document.getElementById('total-number').textContent = String(quizData.quiz.questions.length);

  renderPager();
  renderQuestion();
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
      answers[currentIndex] = idx;
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

  if (isLoading) {
    nextBtn.disabled = true;
    nextBtn.textContent = 'Submitting Quiz...';
    status.textContent = text || 'Quiz is being submitted. Please wait...';
    return;
  }

  nextBtn.disabled = false;
  status.textContent = text || '';
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
    alert('Please answer all questions before submitting.');
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
    setSubmitLoading(false, '');
    window.location.href = './feedback.html';
  } catch (error) {
    setSubmitLoading(false, '');
    alert(error.message);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.prelabAuth.signOut();
  window.location.href = './home.html';
});

bootstrap();
