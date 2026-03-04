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

function showFeedbackSkeleton() {
  const reviewList = document.getElementById('review-list');
  const tipsList = document.getElementById('tips-list');
  if (reviewList) {
    reviewList.innerHTML = `
      <div class="skeleton-grid loading-shell">
        <div class="skeleton-card skeleton-card--tall"></div>
        <div class="skeleton-card skeleton-card--tall"></div>
      </div>
    `;
  }
  if (tipsList) {
    tipsList.innerHTML = `
      <li class="skeleton-card" style="list-style:none;height:18px;"></li>
      <li class="skeleton-card" style="list-style:none;height:18px;"></li>
    `;
  }
}

async function bootstrap() {
  showFeedbackSkeleton();
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const result = await resolveActiveResult(authUser.id);
  if (!result.id) {
    await window.prelabDialog.alert('No result found.', {
      title: 'Result Missing',
      icon: 'warning'
    });
    goTo('/pages/dashboard');
    return;
  }

  renderResult(result);
}

async function resolveActiveResult(userId) {
  const params = new URLSearchParams(window.location.search || '');
  const resultId = String(params.get('resultId') || '').trim();
  const cached = JSON.parse(window.localStorage.getItem('prelab_result') || '{}');

  if (!resultId) return cached;
  if (cached.id === resultId) return cached;

  try {
    const payload = await window.api.get(
      `/results/${encodeURIComponent(resultId)}?userId=${encodeURIComponent(userId)}`
    );
    if (payload?.result?.id) {
      window.localStorage.setItem('prelab_result', JSON.stringify(payload.result));
      return payload.result;
    }
  } catch (_error) {
  }

  window.localStorage.removeItem('prelab_result');
  return {};
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

  if (!review.length) {
    reviewList.innerHTML = `
      <div class="empty-state">
        <strong>No answer review available</strong>
        Try generating and submitting a new quiz to view detailed breakdowns.
      </div>
    `;
  }

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

  const retryLink = document.getElementById('retry-study-link');
  if (retryLink && result.module_id) {
    retryLink.href = `/pages/study?moduleId=${encodeURIComponent(result.module_id)}`;
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.confirmAndSignOut();
});

bootstrap();

