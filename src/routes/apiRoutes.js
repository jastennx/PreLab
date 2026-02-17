const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const config = require('../config');
const { supabaseAdmin } = require('../services/supabaseClient');
const {
  generateExplanation,
  generateQuiz,
  evaluateQuiz,
  generateFeedback,
  chatTutor
} = require('../services/aiService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function fail(res, error, code = 500) {
  res.status(code).json({ error: error.message || 'Unexpected error' });
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

    const reusableQuiz = (existingQuizzes || []).find((q) => {
      const count = Array.isArray(q?.quiz_json?.questions) ? q.quiz_json.questions.length : 0;
      return count === safeCount;
    });

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

    const quiz = await generateQuiz({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      count: safeCount
    });

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
    const { quizId, moduleId, userId, answers } = req.body;
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
        ai: aiFeedback
      },
      weak_areas: evaluated.weakAreas
    };

    const { data: resultRecord, error: resultError } = await supabaseAdmin
      .from('results')
      .insert(payload)
      .select('*')
      .single();

    if (resultError) throw resultError;

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






