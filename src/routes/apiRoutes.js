const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const config = require('../config');
const { supabaseAdmin } = require('../services/supabaseClient');
const {
  generateExplanation,
  generateQuiz,
  generateTargetedReviewQuiz,
  evaluateQuiz,
  generateFeedback,
  chatTutor,
  generateFlashcards,
  generateStudyPlan
} = require('../services/aiService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function fail(res, error, code = 500) {
  res.status(code).json({ error: error.message || 'Unexpected error' });
}

const MAX_QUIZ_GUIDANCE_LENGTH = 600;
const MAX_MOCK_EXAM_MINUTES = 180;
const MIN_MOCK_EXAM_MINUTES = 5;

function normalizeQuizGuidance(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUIZ_GUIDANCE_LENGTH);
}

function normalizeQuizMode(value) {
  return String(value || '').toLowerCase() === 'mock_exam' ? 'mock_exam' : 'practice';
}

function normalizeMockExamMinutes(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(MIN_MOCK_EXAM_MINUTES, Math.min(MAX_MOCK_EXAM_MINUTES, Math.round(raw)));
}

function calculateNextReviewAt(timesMissed) {
  const safeMisses = Math.max(1, Number(timesMissed) || 1);
  const days = safeMisses <= 1 ? 1 : safeMisses === 2 ? 2 : safeMisses === 3 ? 4 : 7;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

async function ensurePublicUser(userId) {
  if (!userId) throw new Error('userId is required');

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return;

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authError || !authData?.user) {
    throw new Error('User profile missing and auth user not found. Please sign out and sign in again.');
  }

  const authUser = authData.user;
  const fullName =
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.name ||
    '';

  const { error: insertError } = await supabaseAdmin.from('users').insert({
    id: authUser.id,
    email: authUser.email,
    full_name: fullName
  });

  if (insertError) throw insertError;
}

async function extractMaterialTextFromBuffer({ name, mime, buffer }) {
  const fileName = (name || '').toLowerCase();
  const fileMime = (mime || '').toLowerCase();

  if (fileMime.includes('pdf') || fileName.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    return (parsed.text || '').trim();
  }

  if (fileMime.includes('officedocument.wordprocessingml.document') || fileName.endsWith('.docx')) {
    const parsed = await mammoth.extractRawText({ buffer });
    return (parsed.value || '').trim();
  }

  throw new Error('Unsupported file type. Upload only .pdf or .docx.');
}

async function extractMaterialText(file) {
  if (!file) return '';

  return extractMaterialTextFromBuffer({
    name: file.originalname,
    mime: file.mimetype,
    buffer: file.buffer
  });
}

async function extractMaterialTextFromStoragePath(storagePath, userId) {
  if (!storagePath) return '';
  const safePath = storagePath.replace(/^\/+/, '').trim();
  if (!safePath) return '';
  if (!safePath.startsWith(`${userId}/`)) {
    throw new Error('Invalid file path. Please upload again.');
  }

  const { data: blob, error } = await supabaseAdmin.storage
    .from(config.studyMaterialsBucket)
    .download(safePath);

  if (error) throw error;
  if (!blob) throw new Error('Uploaded file not found in storage.');

  const buffer = Buffer.from(await blob.arrayBuffer());
  const extension = (safePath.split('.').pop() || '').toLowerCase();

  return extractMaterialTextFromBuffer({
    name: safePath,
    mime: extension === 'pdf' ? 'application/pdf' : '',
    buffer
  });
}
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PreLab API' });
});

router.get('/public-config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    studyMaterialsBucket: config.studyMaterialsBucket
  });
});

router.post('/auth/sync-user', async (req, res) => {
  try {
    const userId = (req.body.userId || '').trim();
    const email = (req.body.email || '').trim();
    const fullName = (req.body.fullName || '').trim();

    if (!userId || !email) {
      return res.status(400).json({ error: 'userId and email are required' });
    }

    const { error } = await supabaseAdmin.from('users').upsert(
      {
        id: userId,
        email,
        full_name: fullName
      },
      { onConflict: 'id' }
    );
    if (error) throw error;

    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/modules', upload.single('materialFile'), async (req, res) => {
  try {
    const userId = (req.body.userId || '').trim();
    const subjectName = (req.body.subjectName || '').trim();
    const moduleTitle = (req.body.moduleTitle || '').trim();
    const materialText = (req.body.materialText || '').trim();
    const studyGoal = (req.body.studyGoal || '').trim();
    const storagePath = (req.body.storagePath || '').trim();
    let sourceText = (materialText || '').trim();
    if (!sourceText && req.file) {
      sourceText = await extractMaterialText(req.file);
    }
    if (!sourceText && storagePath) {
      sourceText = await extractMaterialTextFromStoragePath(storagePath, userId);
    }

    if (!userId || !subjectName || !moduleTitle) {
      return res.status(400).json({
        error: 'userId, subjectName, and moduleTitle are required'
      });
    }

    if (!sourceText && req.file) {
      return res.status(400).json({
        error: 'Uploaded file has no readable text. Try another PDF/DOCX or paste text manually.'
      });
    }

    if (!sourceText && storagePath) {
      return res.status(400).json({
        error: 'Stored file has no readable text. Upload another PDF/DOCX or paste text.'
      });
    }

    if (!sourceText) {
      return res.status(400).json({
        error: 'Study material is required. Upload PDF/DOCX or paste text.'
      });
    }

    await ensurePublicUser(userId);

    const { data: subject, error: subjectError } = await supabaseAdmin
      .from('subjects')
      .upsert({ name: subjectName, created_by: userId }, { onConflict: 'name' })
      .select('id,name')
      .single();

    if (subjectError) throw subjectError;

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .insert({
        user_id: userId,
        subject_id: subject.id,
        title: moduleTitle,
        source_text: sourceText,
        study_goal: studyGoal || null,
        status: 'new'
      })
      .select('*')
      .single();

    if (moduleError) throw moduleError;

    res.status(201).json({ module });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/modules', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query parameter is required' });

    const { data, error } = await supabaseAdmin
      .from('modules')
      .select('id,title,status,created_at,study_goal,subjects(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ modules: data || [] });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/modules/:id', async (req, res) => {
  try {
    const moduleId = req.params.id;
    const { data, error } = await supabaseAdmin
      .from('modules')
      .select('*, subjects(name)')
      .eq('id', moduleId)
      .single();

    if (error) throw error;
    res.json({ module: data });
  } catch (error) {
    fail(res, error, 404);
  }
});

router.delete('/modules/:id', async (req, res) => {
  try {
    const moduleId = req.params.id;
    const { error } = await supabaseAdmin.from('modules').delete().eq('id', moduleId);
    if (error) throw error;
    res.json({ message: 'Module deleted' });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/study/explain', async (req, res) => {
  try {
    const { moduleId, topic } = req.body;
    if (!moduleId) return res.status(400).json({ error: 'moduleId is required' });

    const { data: module, error } = await supabaseAdmin
      .from('modules')
      .select('id,title,source_text,subjects(name)')
      .eq('id', moduleId)
      .single();

    if (error) throw error;

    const explanation = await generateExplanation({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      topic
    });

    res.json({ explanation });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/practice/generate', async (req, res) => {
  try {
    const { moduleId, userId, questionCount } = req.body;
    const quizGuidance = normalizeQuizGuidance(req.body.quizGuidance);
    const quizMode = normalizeQuizMode(req.body.quizMode);
    const mockExamMinutes = normalizeMockExamMinutes(req.body.mockExamMinutes);
    if (!moduleId || !userId) {
      return res.status(400).json({ error: 'moduleId and userId are required' });
    }

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .select('id,title,source_text,subjects(name)')
      .eq('id', moduleId)
      .single();

    if (moduleError) throw moduleError;

    const requestedCount = Number(questionCount || 10);
    const safeCount = Number.isFinite(requestedCount)
      ? Math.min(50, Math.max(10, requestedCount))
      : 10;

    const { data: existingQuizzes, error: existingQuizError } = await supabaseAdmin
      .from('quizzes')
      .select('id,quiz_json,created_at')
      .eq('module_id', moduleId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (existingQuizError) throw existingQuizError;

    const canReuseQuiz = !quizGuidance;
    const reusableQuiz = canReuseQuiz
      ? (existingQuizzes || []).find((q) => {
          const count = Array.isArray(q?.quiz_json?.questions) ? q.quiz_json.questions.length : 0;
          const storedGuidance = normalizeQuizGuidance(
            q?.quiz_json?.custom_guidance || q?.quiz_json?.quiz_guidance || ''
          );
          const storedMode = normalizeQuizMode(q?.quiz_json?.quiz_mode || 'practice');
          return count === safeCount && storedGuidance === quizGuidance && storedMode === quizMode;
        })
      : null;

    if (reusableQuiz) {
      const reusedCount = Array.isArray(reusableQuiz.quiz_json?.questions)
        ? reusableQuiz.quiz_json.questions.length
        : 0;
      return res.status(200).json({
        quizId: reusableQuiz.id,
        quiz: reusableQuiz.quiz_json,
        reused: true,
        warning:
          reusedCount < safeCount
            ? `Using your saved quiz with ${reusedCount}/${safeCount} questions due to API limits.`
            : null
      });
    }

    const generatedQuiz = await generateQuiz({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      count: safeCount,
      quizGuidance
    });
    const quiz = {
      ...generatedQuiz,
      quiz_mode: quizMode,
      mock_exam_minutes: quizMode === 'mock_exam' ? mockExamMinutes : null
    };

    const { data: quizRecord, error: quizError } = await supabaseAdmin
      .from('quizzes')
      .insert({
        module_id: moduleId,
        user_id: userId,
        quiz_json: quiz
      })
      .select('*')
      .single();

    if (quizError) throw quizError;

    await supabaseAdmin.from('modules').update({ status: 'quiz_ready' }).eq('id', moduleId);

    res.status(201).json({
      quizId: quizRecord.id,
      quiz: quizRecord.quiz_json,
      warning:
        quiz?.partial && quiz.generated_count < safeCount
          ? `Generated ${quiz.generated_count}/${safeCount} questions due to API limits. You can still continue.`
          : null
    });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/practice/submit', async (req, res) => {
  try {
    const { quizId, moduleId, userId, answers, elapsedSeconds } = req.body;
    if (!quizId || !moduleId || !userId || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'quizId, moduleId, userId and answers[] are required' });
    }

    const { data: quizRecord, error: quizError } = await supabaseAdmin
      .from('quizzes')
      .select('id,quiz_json')
      .eq('id', quizId)
      .single();

    if (quizError) throw quizError;

    const questions = quizRecord.quiz_json?.questions || [];
    const evaluated = evaluateQuiz({ questions, userAnswers: answers });

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .select('title')
      .eq('id', moduleId)
      .single();

    if (moduleError) throw moduleError;

    const aiFeedback = await generateFeedback({
      moduleTitle: module.title,
      score: evaluated.score,
      weakAreas: evaluated.weakAreas,
      review: evaluated.review
    });

    const payload = {
      quiz_id: quizId,
      module_id: moduleId,
      user_id: userId,
      score: evaluated.score,
      correct_count: evaluated.correctCount,
      total_questions: evaluated.total,
      feedback: {
        review: evaluated.review,
        ai: aiFeedback,
        metadata: {
          elapsed_seconds: Number.isFinite(Number(elapsedSeconds))
            ? Math.max(0, Math.round(Number(elapsedSeconds)))
            : null,
          quiz_mode: normalizeQuizMode(quizRecord.quiz_json?.quiz_mode || 'practice'),
          mock_exam_minutes: quizRecord.quiz_json?.mock_exam_minutes || null
        }
      },
      weak_areas: evaluated.weakAreas
    };

    const { data: resultRecord, error: resultError } = await supabaseAdmin
      .from('results')
      .insert(payload)
      .select('*')
      .single();

    if (resultError) throw resultError;

    const mistakes = (evaluated.review || []).filter((item) => !item.is_correct);
    for (const mistake of mistakes) {
      const questionText = String(mistake.question || '').trim();
      if (!questionText) continue;

      const { data: existingMistake, error: existingError } = await supabaseAdmin
        .from('mistake_notebook')
        .select('id,times_missed')
        .eq('user_id', userId)
        .eq('module_id', moduleId)
        .eq('question_text', questionText)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existingMistake?.id) {
        const nextMissCount = Number(existingMistake.times_missed || 1) + 1;
        const { error: updateError } = await supabaseAdmin
          .from('mistake_notebook')
          .update({
            result_id: resultRecord.id,
            topic: mistake.topic || 'General',
            selected_answer: mistake.selected_answer || null,
            correct_answer: mistake.correct_answer || '',
            explanation: mistake.explanation || '',
            times_missed: nextMissCount,
            last_missed_at: new Date().toISOString(),
            next_review_at: calculateNextReviewAt(nextMissCount),
            resolved: false
          })
          .eq('id', existingMistake.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertMistakeError } = await supabaseAdmin.from('mistake_notebook').insert({
          user_id: userId,
          module_id: moduleId,
          result_id: resultRecord.id,
          question_text: questionText,
          topic: mistake.topic || 'General',
          selected_answer: mistake.selected_answer || null,
          correct_answer: mistake.correct_answer || '',
          explanation: mistake.explanation || '',
          times_missed: 1,
          next_review_at: calculateNextReviewAt(1),
          resolved: false
        });
        if (insertMistakeError) throw insertMistakeError;
      }
    }

    const quizMode = normalizeQuizMode(quizRecord.quiz_json?.quiz_mode || 'practice');
    if (quizMode === 'review') {
      const correctedQuestions = (evaluated.review || [])
        .filter((item) => item.is_correct)
        .map((item) => String(item.question || '').trim())
        .filter(Boolean);
      if (correctedQuestions.length) {
        const { error: resolveError } = await supabaseAdmin
          .from('mistake_notebook')
          .update({ resolved: true })
          .eq('user_id', userId)
          .eq('module_id', moduleId)
          .in('question_text', correctedQuestions);
        if (resolveError) throw resolveError;
      }
    }

    await supabaseAdmin.from('ai_feedback').insert({
      user_id: userId,
      module_id: moduleId,
      result_id: resultRecord.id,
      feedback_json: aiFeedback
    });

    await supabaseAdmin.from('modules').update({ status: 'completed' }).eq('id', moduleId);

    res.json({ result: resultRecord });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/results', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query parameter is required' });

    const { data, error } = await supabaseAdmin
      .from('results')
      .select('id,score,correct_count,total_questions,created_at,module_id,modules(title)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ results: data || [] });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/results/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('results')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json({ result: data });
  } catch (error) {
    fail(res, error, 404);
  }
});

router.get('/mistakes', async (req, res) => {
  try {
    const { userId, moduleId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query parameter is required' });

    let query = supabaseAdmin
      .from('mistake_notebook')
      .select(
        'id,module_id,question_text,topic,selected_answer,correct_answer,explanation,times_missed,next_review_at,resolved,created_at'
      )
      .eq('user_id', userId)
      .order('next_review_at', { ascending: true })
      .order('created_at', { ascending: false });

    if (moduleId) {
      query = query.eq('module_id', moduleId);
    }

    const { data, error } = await query.limit(200);
    if (error) throw error;
    res.json({ mistakes: data || [] });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/flashcards/generate', async (req, res) => {
  try {
    const { moduleId, userId, count } = req.body;
    if (!moduleId || !userId) {
      return res.status(400).json({ error: 'moduleId and userId are required' });
    }

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .select('id,title,source_text,subjects(name)')
      .eq('id', moduleId)
      .single();
    if (moduleError) throw moduleError;

    const cards = await generateFlashcards({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      count: Number(count || 20)
    });

    const payload = cards.map((card) => ({
      user_id: userId,
      module_id: moduleId,
      front: card.front,
      back: card.back,
      difficulty: card.difficulty,
      topic: card.topic
    }));

    await supabaseAdmin.from('flashcards').delete().eq('user_id', userId).eq('module_id', moduleId);

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('flashcards')
      .insert(payload)
      .select('*');
    if (insertError) throw insertError;

    res.status(201).json({ flashcards: inserted || [] });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/flashcards', async (req, res) => {
  try {
    const { userId, moduleId } = req.query;
    if (!userId || !moduleId) {
      return res.status(400).json({ error: 'userId and moduleId query parameters are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('flashcards')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .order('is_hard', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;

    res.json({ flashcards: data || [] });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/flashcards/:id/hard', async (req, res) => {
  try {
    const { userId, isHard } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { data, error } = await supabaseAdmin
      .from('flashcards')
      .update({
        is_hard: Boolean(isHard),
        last_reviewed_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) throw error;

    res.json({ flashcard: data });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/study-plan/generate', async (req, res) => {
  try {
    const { moduleId, userId, deadline } = req.body;
    if (!moduleId || !userId || !deadline) {
      return res.status(400).json({ error: 'moduleId, userId, and deadline are required' });
    }

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .select('id,title,source_text,study_goal,subjects(name)')
      .eq('id', moduleId)
      .single();
    if (moduleError) throw moduleError;

    const { data: weakRows, error: weakError } = await supabaseAdmin
      .from('mistake_notebook')
      .select('topic,times_missed')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .eq('resolved', false)
      .order('times_missed', { ascending: false })
      .limit(10);
    if (weakError) throw weakError;
    const weakAreas = (weakRows || []).map((row) => row.topic).filter(Boolean);

    const plan = await generateStudyPlan({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      studyGoal: module.study_goal || '',
      deadlineISO: String(deadline),
      weakAreas
    });

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('study_plans')
      .insert({
        user_id: userId,
        module_id: moduleId,
        deadline: String(deadline),
        plan_json: plan
      })
      .select('*')
      .single();
    if (saveError) throw saveError;

    res.status(201).json({ plan: saved });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/study-plan', async (req, res) => {
  try {
    const { userId, moduleId } = req.query;
    if (!userId || !moduleId) {
      return res.status(400).json({ error: 'userId and moduleId query parameters are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('study_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    res.json({ plan: data || null });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/review/daily', async (req, res) => {
  try {
    const { userId, moduleId, questionCount } = req.body;
    if (!userId || !moduleId) {
      return res.status(400).json({ error: 'userId and moduleId are required' });
    }

    const nowIso = new Date().toISOString();
    const { data: dueMistakes, error: mistakesError } = await supabaseAdmin
      .from('mistake_notebook')
      .select('question_text,topic,correct_answer,selected_answer,explanation,times_missed,next_review_at')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .eq('resolved', false)
      .lte('next_review_at', nowIso)
      .order('times_missed', { ascending: false })
      .limit(25);
    if (mistakesError) throw mistakesError;

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .select('id,title,source_text,subjects(name)')
      .eq('id', moduleId)
      .single();
    if (moduleError) throw moduleError;

    const weakAreas = Array.from(new Set((dueMistakes || []).map((m) => m.topic).filter(Boolean)));
    const targetCount = Number(questionCount || 10);
    const quiz = await generateTargetedReviewQuiz({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      count: targetCount,
      weakAreas,
      mistakeNotes: dueMistakes || []
    });

    const { data: quizRecord, error: quizError } = await supabaseAdmin
      .from('quizzes')
      .insert({
        module_id: moduleId,
        user_id: userId,
        quiz_json: {
          ...quiz,
          quiz_mode: 'review',
          source: 'daily_review',
          due_mistake_count: (dueMistakes || []).length
        }
      })
      .select('*')
      .single();
    if (quizError) throw quizError;

    res.status(201).json({
      quizId: quizRecord.id,
      quiz: quizRecord.quiz_json,
      dueMistakes: (dueMistakes || []).length
    });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { moduleId, userId, message, history } = req.body;
    if (!moduleId || !userId || !message) {
      return res.status(400).json({ error: 'moduleId, userId and message are required' });
    }

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .select('id,title,source_text,subjects(name)')
      .eq('id', moduleId)
      .single();

    if (moduleError) throw moduleError;

    const reply = await chatTutor({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      history: history || [],
      message
    });

    const { error: saveError } = await supabaseAdmin.from('chat_messages').insert([
      {
        user_id: userId,
        module_id: moduleId,
        role: 'user',
        content: message
      },
      {
        user_id: userId,
        module_id: moduleId,
        role: 'assistant',
        content: reply
      }
    ]);

    if (saveError) throw saveError;

    res.json({ reply });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/chat/:moduleId', async (req, res) => {
  try {
    const { userId } = req.query;
    const moduleId = req.params.moduleId;
    if (!userId) return res.status(400).json({ error: 'userId query parameter is required' });

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('role,content,created_at')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;






