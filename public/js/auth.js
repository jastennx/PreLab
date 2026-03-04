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
  async signUp(email, password, fullName, emailRedirectTo = '') {
    const client = await this.init();
    if (!client) throw new Error('Supabase client config missing');

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' },
        ...(emailRedirectTo ? { emailRedirectTo } : {})
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
  async requestPasswordReset(email, redirectTo = '') {
    const client = await this.init();
    if (!client) throw new Error('Supabase client config missing');

    const { error } = await client.auth.resetPasswordForEmail(email, {
      ...(redirectTo ? { redirectTo } : {})
    });
    if (error) throw error;
  },
  async setSessionFromRecoveryHash() {
    const client = await this.init();
    if (!client) throw new Error('Supabase client config missing');

    const hash = window.location.hash || '';
    if (!hash.startsWith('#')) return false;

    const params = new URLSearchParams(hash.slice(1));
    const type = params.get('type');
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (type !== 'recovery' || !accessToken || !refreshToken) return false;

    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (error) throw error;
    return true;
  },
  async updatePassword(newPassword) {
    const client = await this.init();
    if (!client) throw new Error('Supabase client config missing');

    const { data, error } = await client.auth.updateUser({ password: newPassword });
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
  },
  async signInWithGoogle(redirectTo = '') {
    const client = await this.init();
    if (!client) throw new Error('Supabase client config missing');

    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo || `${window.location.origin}/pages/signin`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });
    if (error) throw error;
    return data;
  }
};

window.requireAuthUser = async function requireAuthUser() {
  await window.prelabAuth.init();

  if (window.prelabAuth.missingConfig) {
    await window.prelabDialog.alert('Server config is unavailable. Check Vercel environment variables and function logs.', {
      title: 'Configuration Error',
      icon: 'error'
    });
    window.location.href = '/pages/home';
    return null;
  }

  try {
    const user = await window.prelabAuth.getUser();
    if (!user) {
      window.location.href = '/pages/home';
      return null;
    }

    window.localStorage.setItem(
      'prelab_user',
      JSON.stringify({ id: user.id, email: user.email, full_name: user.user_metadata?.full_name || '' })
    );
    return user;
  } catch (_error) {
    window.location.href = '/pages/home';
    return null;
  }
};

window.confirmAndSignOut = async function confirmAndSignOut() {
  const shouldLogout = await window.prelabDialog.confirm('Are you sure you want to log out?', {
    title: 'Log out',
    icon: 'warning',
    confirmButtonText: 'Log out'
  });
  if (!shouldLogout) return false;

  await window.prelabAuth.signOut();
  window.location.href = '/pages/home';
  return true;
};

