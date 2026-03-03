let currentResult = null;

async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const result = JSON.parse(window.localStorage.getItem('prelab_result') || '{}');
  if (!result.id) {
    await window.prelabDialog.alert('No result found.', {
      title: 'Result Missing',
      icon: 'warning'
    });
    window.location.href = '/pages/dashboard';
    return;
  }

  currentResult = result;
  renderResult(result);
  await loadMistakeNotebook(authUser.id, result.module_id);
}

function renderResult(result) {
  const ai = result.feedback?.ai || {};
  const review = result.feedback?.review || [];
  const rawScore = Number(result.score);
  const formattedScore = Number.isFinite(rawScore)
    ? `${Number.isInteger(rawScore) ? rawScore : rawScore.toFixed(1)}%`
    : '-';

  document.getElementById('encouragement').textContent =
    ai.encouragement || 'This is a great opportunity to review the material and strengthen your understanding.';
  document.getElementById('score').textContent = formattedScore;
  document.getElementById('correct').textContent = `${result.correct_count}/${result.total_questions}`;

  const reviewList = document.getElementById('review-list');
  reviewList.innerHTML = '';

  review.forEach((item, index) => {
    const selectedLetter =
      Number.isInteger(item.selected_index) && item.selected_index >= 0
        ? String.fromCharCode(65 + item.selected_index)
        : '-';
    const correctLetter =
      Number.isInteger(item.correct_index) && item.correct_index >= 0
        ? String.fromCharCode(65 + item.correct_index)
        : '-';

    const div = document.createElement('div');
    div.className = `review-item ${item.is_correct ? 'good' : 'bad'}`;
    div.innerHTML = `
      <strong>Question ${index + 1}: ${item.is_correct ? 'CORRECT' : 'INCORRECT'}</strong>
      <p class="review-question"><strong>${item.question}</strong></p>
      <p>Your answer: <strong>${selectedLetter}. ${item.selected_answer || 'No answer'}</strong></p>
      <p>Correct answer: <strong class="correct-answer">${correctLetter}. ${item.correct_answer}</strong></p>
    `;
    reviewList.appendChild(div);
  });

  const tipsList = document.getElementById('tips-list');
  tipsList.innerHTML = '';

  const tips = ai.next_steps?.length ? ai.next_steps : ['Review incorrect answers', 'Focus on weak areas', 'Retake quiz'];
  tips.forEach((tip) => {
    const li = document.createElement('li');
    li.textContent = tip;
    tipsList.appendChild(li);
  });
}

async function loadMistakeNotebook(userId, moduleId) {
  const list = document.getElementById('mistake-list');
  list.innerHTML = '';

  try {
    const data = await window.api.get(`/mistakes?userId=${encodeURIComponent(userId)}&moduleId=${encodeURIComponent(moduleId)}`);
    const mistakes = (data.mistakes || []).slice(0, 12);

    if (!mistakes.length) {
      list.innerHTML = '<p>No open mistakes right now. Great work.</p>';
      return;
    }

    mistakes.forEach((item) => {
      const div = document.createElement('article');
      div.className = 'mistake-item';
      div.innerHTML = `
        <strong>${item.topic || 'General'} | Missed ${item.times_missed} time(s)</strong>
        <p>${item.question_text}</p>
      `;
      list.appendChild(div);
    });
  } catch (error) {
    list.innerHTML = `<p>${error.message}</p>`;
  }
}

document.getElementById('start-review-btn').addEventListener('click', async () => {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;
  if (!currentResult?.module_id) {
    await window.prelabDialog.alert('Module context missing for review quiz.', { title: 'Action Failed', icon: 'error' });
    return;
  }

  try {
    const data = await window.api.post('/review/daily', {
      userId: authUser.id,
      moduleId: currentResult.module_id,
      questionCount: 10
    });
    window.localStorage.setItem('prelab_quiz', JSON.stringify(data));
    window.location.href = '/pages/practice';
  } catch (error) {
    await window.prelabDialog.alert(error.message, { title: 'Daily Review Failed', icon: 'error' });
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.confirmAndSignOut();
});

bootstrap();