window.PRELAB_CONFIG = {
  apiBase: '/api',
  supabaseUrl: '',
  supabaseAnonKey: '',
  studyMaterialsBucket: 'study-materials',
  loaded: false
};

window.loadPrelabConfig = async () => {
  if (window.PRELAB_CONFIG.loaded) return window.PRELAB_CONFIG;

  try {
    const response = await fetch('/api/public-config');
    const runtime = await response.json();
    window.PRELAB_CONFIG.supabaseUrl = runtime.supabaseUrl || '';
    window.PRELAB_CONFIG.supabaseAnonKey = runtime.supabaseAnonKey || '';
    window.PRELAB_CONFIG.studyMaterialsBucket = runtime.studyMaterialsBucket || 'study-materials';
  } catch (_error) {
    window.PRELAB_CONFIG.supabaseUrl = '';
    window.PRELAB_CONFIG.supabaseAnonKey = '';
    window.PRELAB_CONFIG.studyMaterialsBucket = 'study-materials';
  }

  window.PRELAB_CONFIG.loaded = true;
  return window.PRELAB_CONFIG;
};

