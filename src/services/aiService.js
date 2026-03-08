const config = require('../config');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_QUIZ_COUNT = 50;
const QUIZ_BATCH_SIZE = 25;
const QUIZ_MATERIAL_LIMIT = 7000;
const QUIZ_GUIDANCE_LIMIT = 600;
const QUIZ_GENERATION_PROFILE = 'v2_balanced_options';
const DEFAULT_QUIZ_DIFFICULTY_RULE =
  'Default difficulty (when user does not explicitly request easy/hard): medium-to-hard college level requiring reasoning, not rote recall.';
const OPTION_QUALITY_RULES =
  'Answer quality rules: make all options plausible and similar in length/detail. ' +
  'Never make the correct answer obviously longer, more specific, or structurally different than distractors. ' +
  'Avoid giveaway patterns like "all of the above" or "none of the above".';

function assertGroqConfig() {
  if (!config.groqApiKey) {
    throw new Error('GROQ_API_KEY is missing. Set it in your runtime environment and redeploy.');
  }
  if (!config.groqApiKey.startsWith('gsk_')) {
    throw new Error('GROQ_API_KEY format looks invalid. It should start with "gsk_".');
  }
  if (!config.groqModel) {
    throw new Error('GROQ_MODEL is missing. Set it in your runtime environment and redeploy.');
  }
}

function deriveGuidanceHints(guidance) {
  const raw = String(guidance || '').toLowerCase();
  const compact = raw.replace(/[^a-z0-9]/g, '');
  const hints = [];

  if (
    /easy|beginner|basic/.test(raw) ||
    /easy|beginner|basic/.test(compact) ||
    /1stgrade|firstgrade|grade1/.test(compact)
  ) {
    hints.push(
      'Use very easy beginner-level questions with plain wording and straightforward distractors.'
    );
  }

  if (/medium|intermediate/.test(raw) || /medium|intermediate/.test(compact)) {
    hints.push('Use medium difficulty with conceptual understanding, not pure memorization.');
  }

  if (/hard|advanced|challenging|expert/.test(raw) || /hard|advanced|challenging|expert/.test(compact)) {
    hints.push('Use advanced difficulty with deeper reasoning and less obvious distractors.');
  }

  if (/scenario|situational|case/.test(raw) || /scenario|situational|case/.test(compact)) {
    hints.push('Prefer scenario-based or case-based question framing.');
  }

  if (/short|concise/.test(raw) || /short|concise/.test(compact)) {
    hints.push('Keep each question and answer option concise.');
  }

  return hints;
}

function buildGuidanceBlock(quizGuidance) {
  const guidanceSnippet = String(quizGuidance || '').trim().slice(0, QUIZ_GUIDANCE_LIMIT);
  if (!guidanceSnippet) return '';

  const hints = deriveGuidanceHints(guidanceSnippet);
  const hintLines = hints.length ? `\nInterpreted constraints:\n- ${hints.join('\n- ')}` : '';

  return (
    'User quiz customization preferences (MANDATORY):\n' +
    `${guidanceSnippet}${hintLines}\n` +
    'You must apply these preferences to difficulty, style, and scope unless they conflict with factual accuracy.\n\n'
  );
}

function normalizeOptionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasObviousLengthBias(options, correctIndex) {
  if (!Array.isArray(options) || options.length < 2) return true;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return true;

  const normalized = options.map(normalizeOptionText);
  if (normalized.some((opt) => !opt)) return true;

  const charLens = normalized.map((opt) => opt.length);
  const minChars = Math.min(...charLens);
  const maxChars = Math.max(...charLens);
  if (minChars <= 0) return true;

  const spanRatio = maxChars / minChars;
  if (spanRatio > 2.4) return true;

  const correctChars = charLens[correctIndex];
  const wrongChars = charLens.filter((_, idx) => idx !== correctIndex);
  const wrongAvg = wrongChars.reduce((sum, len) => sum + len, 0) / wrongChars.length;
  const wrongMax = Math.max(...wrongChars);

  if (correctChars > wrongMax + 28 && correctChars > wrongAvg * 1.3) return true;

  const wordLens = normalized.map((opt) => opt.split(/\s+/).filter(Boolean).length);
  const minWords = Math.min(...wordLens);
  const maxWords = Math.max(...wordLens);
  if (minWords > 0 && maxWords / minWords > 2.5) return true;

  return false;
}

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

async function askAI(messages, temperature = 0.4, options = {}) {
  assertGroqConfig();
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.groqModel,
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
      response.status === 429 ||
      message.includes('rate limit') ||
      message.includes('quota')
    ) {
      if (attempt < maxRetries) {
        const backoff = 5000 * (attempt + 1);
        console.log(`[AI] Rate limited, waiting ${backoff / 1000}s before retry ${attempt + 1}...`);
        await wait(backoff);
        continue;
      }
      throw new Error('AI rate limit reached. Please wait a moment and try again.');
    }

    if ((response.status === 503) && attempt < maxRetries) {
      await wait(3000 * (attempt + 1));
      continue;
    }

    throw new Error(`AI request failed (${response.status}): ${raw}`);
  }

  throw new Error('AI request failed after retries.');
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

  const raw = await askAI(prompt, 0.3, {
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

async function generateQuiz({ moduleTitle, subjectName, materialText, count = 10, quizGuidance = '' }) {
  const requestedCount = Math.min(MAX_QUIZ_COUNT, Math.max(1, Number(count) || 10));
  const materialSnippet = String(materialText || '').slice(0, QUIZ_MATERIAL_LIMIT);
  const guidanceSnippet = String(quizGuidance || '').trim().slice(0, QUIZ_GUIDANCE_LIMIT);
  const guidanceBlock = buildGuidanceBlock(guidanceSnippet);
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
        content:
          'You create multiple-choice quizzes for college students. Be accurate and clear. ' +
          'If user customization preferences are provided, treat them as strict constraints.'
      },
      {
        role: 'user',
        content:
          `Generate exactly ${batchCount} multiple-choice questions (batch ${batchIndex + 1}/${totalBatches}) for:\n` +
          `Subject: ${subjectName}\nModule: ${moduleTitle}\n` +
          guidanceBlock +
          `Material excerpt:\n${materialSnippet}\n\n` +
          `${DEFAULT_QUIZ_DIFFICULTY_RULE}\n` +
          `${OPTION_QUALITY_RULES}\n` +
          'Keep questions concise. Avoid repeating previous questions. ' +
          'Before finalizing, verify each question follows the user preferences. ' +
          'Return ONLY JSON with this shape:\n' +
          '{\n  "questions": [\n    {\n      "question": "...",\n      "options": ["A", "B", "C", "D"],\n' +
          '      "correct_index": 0,\n      "explanation": "...",\n      "topic": "..."\n    }\n  ]\n}'
      }
    ];

    const raw = await askAI(prompt, 0.4, {
      maxRetries: 3,
      maxTokens: 4096,
      responseFormat: { type: 'json_object' }
    });

    const parsed = safeJsonParse(raw, { questions: [] });
    const batchQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];

    for (const q of batchQuestions) {
      if (!q || !q.question || !Array.isArray(q.options) || q.options.length < 2) continue;

      const normalizedQuestion = String(q.question).trim();
      const dedupeKey = normalizedQuestion.toLowerCase();
      if (!normalizedQuestion || seen.has(dedupeKey)) continue;

      const normalizedOptions = q.options.slice(0, 4).map(normalizeOptionText);
      if (normalizedOptions.length < 2 || normalizedOptions.some((opt) => !opt)) continue;

      const correctIndex = Number.isInteger(q.correct_index) ? q.correct_index : 0;
      if (correctIndex < 0 || correctIndex >= normalizedOptions.length) continue;
      if (hasObviousLengthBias(normalizedOptions, correctIndex)) continue;

      seen.add(dedupeKey);
      collected.push({
        question: normalizedQuestion,
        options: normalizedOptions,
        correct_index: correctIndex,
        explanation: q.explanation ? String(q.explanation) : '',
        topic: q.topic ? String(q.topic) : 'General'
      });

      if (collected.length >= requestedCount) break;
    }

    if (collected.length < requestedCount) {
      await wait(10000);
    }
  }

  let topUpAttempt = 0;
  while (collected.length < requestedCount && topUpAttempt < 3) {
    topUpAttempt += 1;
    const remaining = requestedCount - collected.length;
    const batchCount = Math.min(5, remaining);

    const topUpPrompt = [
      {
        role: 'system',
        content:
          'You create multiple-choice quizzes for college students. Be accurate and clear. ' +
          'If user customization preferences are provided, treat them as strict constraints.'
      },
      {
        role: 'user',
        content:
          `Top-up pass ${topUpAttempt}: generate exactly ${batchCount} NEW multiple-choice questions for:\n` +
          `Subject: ${subjectName}\nModule: ${moduleTitle}\n` +
          guidanceBlock +
          `Material excerpt:\n${materialSnippet}\n\n` +
          `${DEFAULT_QUIZ_DIFFICULTY_RULE}\n` +
          `${OPTION_QUALITY_RULES}\n` +
          'Questions must be different from typical/common prompts. ' +
          'Before finalizing, verify each question follows the user preferences. ' +
          'Return ONLY JSON with this shape:\n' +
          '{\n  "questions": [\n    {\n      "question": "...",\n      "options": ["A", "B", "C", "D"],\n' +
          '      "correct_index": 0,\n      "explanation": "...",\n      "topic": "..."\n    }\n  ]\n}'
      }
    ];

    const raw = await askAI(topUpPrompt, 0.45, {
      maxRetries: 3,
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

      const normalizedOptions = q.options.slice(0, 4).map(normalizeOptionText);
      if (normalizedOptions.length < 2 || normalizedOptions.some((opt) => !opt)) continue;

      const correctIndex = Number.isInteger(q.correct_index) ? q.correct_index : 0;
      if (correctIndex < 0 || correctIndex >= normalizedOptions.length) continue;
      if (hasObviousLengthBias(normalizedOptions, correctIndex)) continue;

      seen.add(dedupeKey);
      collected.push({
        question: normalizedQuestion,
        options: normalizedOptions,
        correct_index: correctIndex,
        explanation: q.explanation ? String(q.explanation) : '',
        topic: q.topic ? String(q.topic) : 'General'
      });
      if (collected.length >= requestedCount) break;
    }

    if (collected.length < requestedCount) {
      await wait(10000);
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
    partial,
    custom_guidance: guidanceSnippet,
    generation_profile: QUIZ_GENERATION_PROFILE
  };
}

function evaluateQuiz({ questions, userAnswers }) {
  const review = questions.map((q, index) => {
    const raw = userAnswers[index];
    const selected = raw === null || raw === undefined ? null : Number(raw);
    const validSelection = Number.isInteger(selected) && selected >= 0;
    const isCorrect = validSelection && selected === q.correct_index;
    return {
      question: q.question,
      topic: q.topic || 'General',
      selected_index: validSelection ? selected : null,
      selected_answer: validSelection ? q.options[selected] : null,
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

  const raw = await askAI(prompt, 0.4, {
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
      content:
        `You are the PreLab study assistant. Explain clearly for college IT students. ` +
        `Subject: ${subjectName}. Module: ${moduleTitle}. ` +
        `Always keep responses organized with short sections and concise bullet points when helpful. ` +
        `Use clean Markdown-like formatting (headings, bullets, numbered steps) and avoid one long wall of text. ` +
        `Do not output JSON unless the user explicitly requests JSON. ` +
        `Use this material as context: ${materialText}`
    }
  ];

  for (const item of history || []) {
    if (!item || !item.role || !item.content) continue;
    if (item.role === 'assistant' || item.role === 'user') {
      messages.push({ role: item.role, content: item.content });
    }
  }

  messages.push({ role: 'user', content: message });
  return askAI(messages, 0.5, { maxTokens: 1200 });
}

module.exports = {
  generateExplanation,
  generateQuiz,
  evaluateQuiz,
  generateFeedback,
  chatTutor
};
