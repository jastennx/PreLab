async function bootstrap() {
  const authUser = await window.requireAuthUser();
  if (!authUser) return;

  const result = JSON.parse(window.localStorage.getItem('prelab_result') || '{}');
  if (!result.id) {
    alert('No result found.');
    window.location.href = '/pages/dashboard.html';
    return;
  }

  renderResult(result);
}

function renderResult(result) {
  const ai = result.feedback?.ai || {};
  const review = result.feedback?.review || [];

  document.getElementById('encouragement').textContent =
    ai.encouragement || 'This is a great opportunity to review the material and strengthen your understanding.';
  document.getElementById('score').textContent = `${result.score}%`;
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
      <p>${item.question}</p>
      <p>Your answer: <strong>${selectedLetter}. ${item.selected_answer || 'No answer'}</strong></p>
      <p>Correct answer: <strong>${correctLetter}. ${item.correct_answer}</strong></p>
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

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.prelabAuth.signOut();
  window.location.href = '/pages/home.html';
});

bootstrap();

