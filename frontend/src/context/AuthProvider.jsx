/**
 * AuthProvider
 * Owns the Supabase session and the matching user_profiles row, and keeps
 * both in sync in real time — so if the HOD reassigns a student's mentor
 * or marks their Form A unlocked, the student's UI updates without a
 * reload.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { describeError } from '../lib/formatters.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }
    // Deliberately two plain queries rather than one PostgREST embed.
    // user_profiles has a self-referencing foreign key (assigned_mentor_id),
    // and embedding across it depends on both the schema cache and the
    // mentor-visibility policy resolving correctly. Fetching the mentor
    // separately keeps login working — and produces a readable error —
    // even if either of those is off.
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[auth] could not load profile:', error.message);
      setProfile(null);
      return null;
    }

    let mentor = null;
    if (data.assigned_mentor_id) {
      const { data: mentorRow, error: mentorError } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, phone, login_id')
        .eq('id', data.assigned_mentor_id)
        .maybeSingle();
      // A missing mentor row is not fatal — the UI shows "not provided".
      if (mentorError) console.warn('[auth] mentor details unavailable:', mentorError.message);
      else mentor = mentorRow;
    }

    // A student's senior mentor (0042), through a function: a student cannot
    // read another student's profile. Absent before the migration.
    let seniorMentor = null;
    if (data.role === 'student') {
      const { data: senior, error: seniorError } = await supabase.rpc('get_my_senior_mentor');
      if (seniorError) console.warn('[auth] senior mentor unavailable:', seniorError.message);
      else seniorMentor = senior ?? null;
    }

    const fullProfile = { ...data, mentor, senior_mentor: seniorMentor };
    setProfile(fullProfile);
    return fullProfile;
  }, []);

  // Boot: restore any existing session, then subscribe to auth changes.
  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session ?? null);
      if (data.session?.user?.id) await loadProfile(data.session.user.id);
      if (active) setLoading(false);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession ?? null);
      if (event === 'SIGNED_OUT' || !nextSession?.user?.id) {
        setProfile(null);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        loadProfile(nextSession.user.id);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Live profile updates (mentor reassignment, star mentee, Form A unlock).
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return undefined;

    const channel = supabase
      .channel(`profile-watch-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_profiles', filter: `id=eq.${userId}` },
        () => loadProfile(userId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, loadProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });
    if (error) throw new Error(describeError(error));

    const loadedProfile = await loadProfile(data.user.id);
    if (loadedProfile && !loadedProfile.is_active) {
      await supabase.auth.signOut();
      throw new Error('This account has been deactivated. Please contact your HOD.');
    }

    // Best-effort last-login stamp; never block sign-in on it.
    supabase
      .from('user_profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', data.user.id)
      .then(({ error: stampError }) => {
        if (stampError) console.warn('[auth] last_login_at not recorded:', stampError.message);
      });

    return loadedProfile;
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const changePassword = useCallback(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(describeError(error));
    await supabase.from('user_profiles').update({ must_change_password: false }).eq('id', session.user.id);
    await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const sendPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`
    });
    if (error) throw new Error(describeError(error));
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      user: session?.user ?? null,
      role: profile?.role ?? null,
      loading,
      isAuthenticated: Boolean(session && profile),
      signIn,
      signOut,
      changePassword,
      sendPasswordReset,
      refreshProfile: () => loadProfile(session?.user?.id)
    }),
    [session, profile, loading, signIn, signOut, changePassword, sendPasswordReset, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
