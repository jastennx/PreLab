window.prelabAuth = {
  missingConfig: true,
  client: null,
  async init() {
    if (this.client) return this.client;

    await window.loadPrelabConfig();
    const { supabaseUrl, supabaseAnonKey } = window.PRELAB_CONFIG;
    if (!supabaseUrl || !supabaseAnonKey) {
      this.missingConfig = true;
      return null;
    }

    this.client = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    this.missingConfig = false;
    return this.client;
  },
  async signUp(email, password, fullName) {
    const client = await this.init();
    if (!client) throw new Error('Supabase client config missing');

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' }
      }
    });
    if (error) throw error;
    return data;
  },
  async signIn(email, password) {
    const client = await this.init();
    if (!client) throw new Error('Supabase client config missing');

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  async signOut() {
    const client = await this.init();
    if (!client) return;

    const { error } = await client.auth.signOut();
    if (error) throw error;
    window.localStorage.removeItem('prelab_user');
  },
  async getUser() {
    const client = await this.init();
    if (!client) return null;

    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    return data.user;
  }
};

window.requireAuthUser = async function requireAuthUser() {
  await window.prelabAuth.init();

  if (window.prelabAuth.missingConfig) {
    alert('Server config is unavailable. Check Vercel environment variables and function logs.');
    window.location.href = '/pages/home.html';
    return null;
  }

  try {
    const user = await window.prelabAuth.getUser();
    if (!user) {
      window.location.href = '/pages/home.html';
      return null;
    }

    window.localStorage.setItem(
      'prelab_user',
      JSON.stringify({ id: user.id, email: user.email, full_name: user.user_metadata?.full_name || '' })
    );
    return user;
  } catch (_error) {
    window.location.href = '/pages/home.html';
    return null;
  }
};

