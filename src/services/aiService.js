const config = require('../config');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_QUIZ_COUNT = 50;
const QUIZ_BATCH_SIZE = 10;
const QUIZ_MATERIAL_LIMIT = 7000;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    const fenced = text.match(/```json([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch (_innerError) {
        return fallback;
      }
    }
    return fallback;
  }
}

async function askOpenRouter(messages, temperature = 0.4, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.appBaseUrl,
        'X-Title': 'PreLab'
      },
      body: JSON.stringify({
        model: config.openRouterModel,
        messages,
        temperature,
        max_tokens: options.maxTokens || 2048,
        response_format: options.responseFormat || undefined
      })
    });

    const raw = await response.text();
    const parsed = safeJsonParse(raw, {});

    if (response.ok) {
      return parsed?.choices?.[0]?.message?.content?.trim() || '';
    }

    const message = String(parsed?.error?.message || raw || '').toLowerCase();
    if (
      response.status === 402 ||
      message.includes('insufficient credits') ||
      message.includes('payment required')
    ) {
      throw new Error('OpenRouter credits exhausted. Use a free model or another free API key.');
    }

    if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
      await wait(1500 * (attempt + 1));
      continue;
    }

    throw new Error(`OpenRouter request failed (${response.status}): ${raw}`);
  }

  throw new Error('OpenRouter request failed after retries.');
}

async function generateExplanation({ moduleTitle, subjectName, materialText, topic }) {
  const prompt = [
    {
      role: 'system',
      content: 'You are an academic tutor. Give concise, beginner-friendly explanations.'
    },
    {
      role: 'user',
      content: `Subject: ${subjectName}\nModule: ${moduleTitle}\nFocus Topic: ${topic || 'General overview'}\nMaterial:\n${materialText}\n\nReturn JSON with keys: summary (string), key_points (array of 4-6 strings), study_tips (array of 3 strings).`
    }
  ];

  const raw = await askOpenRouter(prompt, 0.3, {
    maxTokens: 1800,
    responseFormat: { type: 'json_object' }
  });
  const parsed = safeJsonParse(raw);
  if (parsed && parsed.summary) {
    return parsed;
  }

  return {
    summary: raw,
    key_points: [],
    study_tips: []
  };
}

async function generateQuiz({ moduleTitle, subjectName, materialText, count = 10 }) {
  const requestedCount = Math.min(MAX_QUIZ_COUNT, Math.max(1, Number(count) || 10));
  const materialSnippet = String(materialText || '').slice(0, QUIZ_MATERIAL_LIMIT);
  const totalBatches = Math.ceil(requestedCount / QUIZ_BATCH_SIZE);
  const collected = [];
  const seen = new Set();

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const remaining = requestedCount - collected.length;
    if (remaining <= 0) break;

    const batchCount = Math.min(QUIZ_BATCH_SIZE, remaining);
    const prompt = [
      {
        role: 'system',
        content: 'You create multiple-choice quizzes for college students. Be accurate and clear.'
      },
      {
        role: 'user',
        content:
          `Generate exactly ${batchCount} multiple-choice questions (batch ${batchIndex + 1}/${totalBatches}) for:\n` +
          `Subject: ${subjectName}\nModule: ${moduleTitle}\n` +
          `Material excerpt:\n${materialSnippet}\n\n` +
          'Keep questions concise. Avoid repeating previous questions. Return ONLY JSON with this shape:\n' +
          '{\n  "questions": [\n    {\n      "question": "...",\n      "options": ["A", "B", "C", "D"],\n' +
          '      "correct_index": 0,\n      "explanation": "...",\n      "topic": "..."\n    }\n  ]\n}'
      }
    ];

    const raw = await askOpenRouter(prompt, 0.4, {
      maxRetries: 2,
      maxTokens: 2200,
      responseFormat: { type: 'json_object' }
    });

    const parsed = safeJsonParse(raw, { questions: [] });
    const batchQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];

    for (const q of batchQuestions) {
      if (!q || !q.question || !Array.isArray(q.options) || q.options.length < 2) continue;

      const normalizedQuestion = String(q.question).trim();
      const dedupeKey = normalizedQuestion.toLowerCase();
      if (!normalizedQuestion || seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      collected.push({
        question: normalizedQuestion,
        options: q.options.slice(0, 4).map((o) => String(o)),
        correct_index: Number.isInteger(q.correct_index) ? q.correct_index : 0,
        explanation: q.explanation ? String(q.explanation) : '',
        topic: q.topic ? String(q.topic) : 'General'
      });

      if (collected.length >= requestedCount) break;
    }

    if (collected.length < requestedCount) {
      await wait(350);
    }
  }

  let topUpAttempt = 0;
  while (collected.length < requestedCount && topUpAttempt < 6) {
    topUpAttempt += 1;
    const remaining = requestedCount - collected.length;
    const batchCount = Math.min(5, remaining);

    const topUpPrompt = [
      {
        role: 'system',
        content: 'You create multiple-choice quizzes for college students. Be accurate and clear.'
      },
      {
        role: 'user',
        content:
          `Top-up pass ${topUpAttempt}: generate exactly ${batchCount} NEW multiple-choice questions for:\n` +
          `Subject: ${subjectName}\nModule: ${moduleTitle}\n` +
          `Material excerpt:\n${materialSnippet}\n\n` +
          'Questions must be different from typical/common prompts. Return ONLY JSON with this shape:\n' +
          '{\n  "questions": [\n    {\n      "question": "...",\n      "options": ["A", "B", "C", "D"],\n' +
          '      "correct_index": 0,\n      "explanation": "...",\n      "topic": "..."\n    }\n  ]\n}'
      }
    ];

    const raw = await askOpenRouter(topUpPrompt, 0.45, {
      maxRetries: 1,
      maxTokens: 1400,
      responseFormat: { type: 'json_object' }
    });
    const parsed = safeJsonParse(raw, { questions: [] });
    const topUpQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];

    for (const q of topUpQuestions) {
      if (!q || !q.question || !Array.isArray(q.options) || q.options.length < 2) continue;

      const normalizedQuestion = String(q.question).trim();
      const dedupeKey = normalizedQuestion.toLowerCase();
      if (!normalizedQuestion || seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      collected.push({
        question: normalizedQuestion,
        options: q.options.slice(0, 4).map((o) => String(o)),
        correct_index: Number.isInteger(q.correct_index) ? q.correct_index : 0,
        explanation: q.explanation ? String(q.explanation) : '',
        topic: q.topic ? String(q.topic) : 'General'
      });
      if (collected.length >= requestedCount) break;
    }

    if (collected.length < requestedCount) {
      await wait(250);
    }
  }

  if (!collected.length) {
    throw new Error('Quiz generation is rate-limited right now. Wait 1-2 minutes and try again.');
  }

  const partial = collected.length < requestedCount;
  return {
    questions: collected,
    requested_count: requestedCount,
    generated_count: collected.length,
    partial
  };
}

function evaluateQuiz({ questions, userAnswers }) {
  const review = questions.map((q, index) => {
    const selected = Number(userAnswers[index]);
    const isCorrect = selected === q.correct_index;
    return {
      question: q.question,
      topic: q.topic || 'General',
      selected_index: Number.isInteger(selected) ? selected : null,
      selected_answer: Number.isInteger(selected) ? q.options[selected] : null,
      correct_index: q.correct_index,
      correct_answer: q.options[q.correct_index],
      is_correct: isCorrect,
      explanation: q.explanation || ''
    };
  });

  const correctCount = review.filter((item) => item.is_correct).length;
  const total = review.length;
  const score = total > 0 ? Number(((correctCount / total) * 100).toFixed(1)) : 0;

  const weakTopicMap = new Map();
  for (const item of review) {
    if (item.is_correct) continue;
    const key = item.topic || 'General';
    weakTopicMap.set(key, (weakTopicMap.get(key) || 0) + 1);
  }

  const weakAreas = [...weakTopicMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);

  return { review, correctCount, total, score, weakAreas };
}

async function generateFeedback({ moduleTitle, score, weakAreas, review }) {
  const prompt = [
    {
      role: 'system',
      content: 'You are a supportive study coach. Give practical, specific improvement advice.'
    },
    {
      role: 'user',
      content: `Module: ${moduleTitle}\nScore: ${score}\nWeak areas: ${weakAreas.join(', ') || 'None'}\nQuestion review: ${JSON.stringify(review)}\n\nReturn JSON with keys: encouragement (string), weak_area_suggestions (array of strings), next_steps (array of 3-5 strings).`
    }
  ];

  const raw = await askOpenRouter(prompt, 0.4, {
    maxTokens: 1400,
    responseFormat: { type: 'json_object' }
  });
  const parsed = safeJsonParse(raw);
  if (parsed && parsed.encouragement) {
    return parsed;
  }

  return {
    encouragement: 'Keep practicing. You are improving with each attempt.',
    weak_area_suggestions: weakAreas,
    next_steps: ['Review incorrect answers', 'Revisit module summary', 'Take another quiz']
  };
}

async function chatTutor({ moduleTitle, subjectName, materialText, history, message }) {
  const messages = [
    {
      role: 'system',
      content: `You are the PreLab study assistant. Explain clearly for college IT students. Subject: ${subjectName}. Module: ${moduleTitle}. Use this material as context: ${materialText}`
    }
  ];

  for (const item of history || []) {
    if (!item || !item.role || !item.content) continue;
    if (item.role === 'assistant' || item.role === 'user') {
      messages.push({ role: item.role, content: item.content });
    }
  }

  messages.push({ role: 'user', content: message });
  return askOpenRouter(messages, 0.5, { maxTokens: 1200 });
}

module.exports = {
  generateExplanation,
  generateQuiz,
  evaluateQuiz,
  generateFeedback,
  chatTutor
};
