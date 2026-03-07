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

const MAX_QUIZ_GUIDANCE_LENGTH = 600;

function normalizeQuizGuidance(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUIZ_GUIDANCE_LENGTH);
}

function requestedUserIdFromRequest(req) {
  const fromBody = String(req.body?.userId || '').trim();
  const fromQuery = String(req.query?.userId || '').trim();
  return fromBody || fromQuery || '';
}

function resolveAuthenticatedUserId(req) {
  const authUserId = String(req.authUser?.id || '').trim();
  if (!authUserId) {
    const error = new Error('Unauthorized');
    error.statusCode = 401;
    throw error;
  }

  const requestedUserId = requestedUserIdFromRequest(req);
  if (requestedUserId && requestedUserId !== authUserId) {
    const error = new Error('userId does not match authenticated user');
    error.statusCode = 403;
    throw error;
  }

  return authUserId;
}

async function requireAuthenticatedUser(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.authUser = data.user;
    next();
  } catch (error) {
    return fail(res, error, error.statusCode || 401);
  }
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

router.get('/debug-env', (_req, res) => {
  if (process.env.NODE_ENV === 'production' || config.isVercel) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.json({
    hasGroqKey: Boolean(config.groqApiKey),
    hasSupabaseUrl: Boolean(config.supabaseUrl),
    hasAnonKey: Boolean(config.supabaseAnonKey),
    hasServiceRoleKey: Boolean(config.supabaseServiceRoleKey),
    model: config.groqModel || 'not set',
    nodeEnv: process.env.NODE_ENV || 'development'
  });
});

router.get('/public-config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    studyMaterialsBucket: config.studyMaterialsBucket
  });
});

const ALLOWED_CATEGORIES = [
  'Science', 'Mathematics', 'Engineering', 'IT & Computer Science',
  'Business', 'Arts & Humanities', 'Health & Medicine', 'Law',
  'Education', 'Social Sciences', 'Other'
];

router.get('/modules/public', async (_req, res) => {
  try {
    const category = (_req.query.category || '').trim();
    let query = supabaseAdmin
      .from('modules')
      .select('id,title,category,status,created_at,study_goal,user_id,subjects(name),users(full_name)')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(60);

    if (category && ALLOWED_CATEGORIES.includes(category)) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ modules: data || [] });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/modules/categories', (_req, res) => {
  res.json({ categories: ALLOWED_CATEGORIES });
});

router.use(requireAuthenticatedUser);

async function resolveAccessibleModule(moduleId, userId, selectCols = '*, subjects(name)') {
  const { data: ownModule, error: ownError } = await supabaseAdmin
    .from('modules')
    .select(selectCols)
    .eq('id', moduleId)
    .eq('user_id', userId)
    .maybeSingle();

  if (ownError) throw ownError;
  if (ownModule) return ownModule;

  const { data: pubModule, error: pubError } = await supabaseAdmin
    .from('modules')
    .select(selectCols)
    .eq('id', moduleId)
    .eq('is_public', true)
    .maybeSingle();

  if (pubError) throw pubError;
  if (!pubModule) {
    const err = new Error('Module not found');
    err.statusCode = 404;
    throw err;
  }
  return pubModule;
}

router.post('/auth/sync-user', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const email = String(req.authUser?.email || '').trim();
    const fullName =
      String(req.body.fullName || '').trim() ||
      String(req.authUser?.user_metadata?.full_name || '').trim() ||
      String(req.authUser?.user_metadata?.name || '').trim();

    if (!email) return res.status(400).json({ error: 'Authenticated user email is required' });

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
    fail(res, error, error.statusCode || 500);
  }
});

router.post('/modules', upload.single('materialFile'), async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
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

    if (!subjectName || !moduleTitle) {
      return res.status(400).json({
        error: 'subjectName and moduleTitle are required'
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

    const isPublic = req.body.isPublic === true || req.body.isPublic === 'true';
    const rawCategory = (req.body.category || '').trim();
    const category = isPublic && ALLOWED_CATEGORIES.includes(rawCategory) ? rawCategory : null;

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .insert({
        user_id: userId,
        subject_id: subject.id,
        title: moduleTitle,
        source_text: sourceText,
        study_goal: studyGoal || null,
        status: 'new',
        is_public: isPublic,
        category: category
      })
      .select('*')
      .single();

    if (moduleError) throw moduleError;

    res.status(201).json({ module });
  } catch (error) {
    fail(res, error, error.statusCode || 500);
  }
});

router.get('/modules', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);

    const { data, error } = await supabaseAdmin
      .from('modules')
      .select('id,title,status,created_at,study_goal,is_public,category,subjects(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ modules: data || [] });
  } catch (error) {
    fail(res, error, error.statusCode || 500);
  }
});

router.get('/modules/:id', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const moduleId = req.params.id;
    const module = await resolveAccessibleModule(moduleId, userId);
    res.json({ module });
  } catch (error) {
    fail(res, error, error.statusCode || 404);
  }
});

router.patch('/modules/:id/visibility', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const moduleId = req.params.id;
    const isPublic = req.body.isPublic === true || req.body.isPublic === 'true';
    const rawCategory = (req.body.category || '').trim();
    const category = isPublic && ALLOWED_CATEGORIES.includes(rawCategory) ? rawCategory : null;

    const { data, error } = await supabaseAdmin
      .from('modules')
      .update({ is_public: isPublic, category })
      .eq('id', moduleId)
      .eq('user_id', userId)
      .select('id,is_public,category')
      .single();

    if (error) throw error;
    res.json({ module: data });
  } catch (error) {
    fail(res, error, error.statusCode || 500);
  }
});

router.delete('/modules/:id', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);

    const moduleId = req.params.id;
    const { data, error } = await supabaseAdmin
      .from('modules')
      .delete()
      .eq('id', moduleId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Module not found' });
    res.json({ message: 'Module deleted' });
  } catch (error) {
    fail(res, error, error.statusCode || 500);
  }
});

router.post('/study/explain', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const { moduleId, topic } = req.body;
    if (!moduleId) return res.status(400).json({ error: 'moduleId is required' });

    const module = await resolveAccessibleModule(moduleId, userId, 'id,title,source_text,subjects(name)');

    const explanation = await generateExplanation({
      moduleTitle: module.title,
      subjectName: module.subjects?.name || 'General',
      materialText: module.source_text,
      topic
    });

    res.json({ explanation });
  } catch (error) {
    fail(res, error, error.statusCode || 500);
  }
});

router.post('/practice/generate', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const { moduleId, questionCount } = req.body;
    const quizGuidance = normalizeQuizGuidance(req.body.quizGuidance);
    if (!moduleId) {
      return res.status(400).json({ error: 'moduleId is required' });
    }

    const { data: module, error: moduleError } = await supabaseAdmin
      .from('modules')
      .select('id,title,source_text,subjects(name)')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .maybeSingle();

    let resolvedModule = module;
    if (moduleError) throw moduleError;
    if (!resolvedModule) {
      resolvedModule = await resolveAccessibleModule(moduleId, userId, 'id,title,source_text,subjects(name)');
    }

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
          return count === safeCount && storedGuidance === quizGuidance;
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

    const quiz = await generateQuiz({
      moduleTitle: resolvedModule.title,
      subjectName: resolvedModule.subjects?.name || 'General',
      materialText: resolvedModule.source_text,
      count: safeCount,
      quizGuidance
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
    fail(res, error, error.statusCode || 500);
  }
});

router.post('/practice/submit', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const { quizId, moduleId, answers } = req.body;
    if (!quizId || !moduleId || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'quizId, moduleId and answers[] are required' });
    }

    const { data: quizRecord, error: quizError } = await supabaseAdmin
      .from('quizzes')
      .select('id,module_id,user_id,quiz_json')
      .eq('id', quizId)
      .eq('module_id', moduleId)
      .eq('user_id', userId)
      .single();

    if (quizError) throw quizError;

    const questions = quizRecord.quiz_json?.questions || [];
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ error: 'Quiz has no questions' });
    }
    if (answers.length !== questions.length) {
      return res.status(400).json({ error: 'answers[] must match quiz question count' });
    }
    const evaluated = evaluateQuiz({ questions, userAnswers: answers });

    const submitModule = await resolveAccessibleModule(moduleId, userId, 'title');

    const aiFeedback = await generateFeedback({
      moduleTitle: submitModule.title,
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
    fail(res, error, error.statusCode || 500);
  }
});

router.get('/results', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);

    const { data, error } = await supabaseAdmin
      .from('results')
      .select('id,score,correct_count,total_questions,created_at,module_id,modules(title)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ results: data || [] });
  } catch (error) {
    fail(res, error, error.statusCode || 500);
  }
});

router.get('/results/:id', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);

    const { data, error } = await supabaseAdmin
      .from('results')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    res.json({ result: data });
  } catch (error) {
    fail(res, error, error.statusCode || 404);
  }
});

router.get('/quizzes/:id', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);

    const { data, error } = await supabaseAdmin
      .from('quizzes')
      .select('id,module_id,user_id,quiz_json,created_at')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    res.json({ quiz: data });
  } catch (error) {
    fail(res, error, error.statusCode || 404);
  }
});

router.post('/chat', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const { moduleId, message, history } = req.body;
    if (!moduleId || !message) {
      return res.status(400).json({ error: 'moduleId and message are required' });
    }

    const module = await resolveAccessibleModule(moduleId, userId, 'id,title,source_text,subjects(name)');

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
    fail(res, error, error.statusCode || 500);
  }
});

router.get('/chat/:moduleId', async (req, res) => {
  try {
    const userId = resolveAuthenticatedUserId(req);
    const moduleId = req.params.moduleId;

    await resolveAccessibleModule(moduleId, userId, 'id');

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('role,content,created_at')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (error) {
    fail(res, error, error.statusCode || 500);
  }
});

module.exports = router;






