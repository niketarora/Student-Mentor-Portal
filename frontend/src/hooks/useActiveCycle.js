/**
 * useActiveCycle
 * The academic cycle uploads are filed under right now (migration 0036).
 *
 * Read once per page load and shared: every Cluster Head screen shows it,
 * and it only changes when someone starts or removes a cycle, which calls
 * refreshActiveCycle() so every mounted screen hears about it.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

let cached = null; // { cycle } once loaded
let inflight = null;
const listeners = new Set();

function publish(state) {
  cached = state;
  for (const listener of listeners) listener(state);
}

export function refreshActiveCycle() {
  if (inflight) return inflight;
  inflight = supabase
    .from('academic_cycles')
    .select('*')
    .eq('is_active', true)
    .maybeSingle()
    .then(({ data, error }) => {
      inflight = null;
      publish({ cycle: data ?? null, error: error ?? null });
      // A failed read is not remembered, so the next screen tries again.
      if (error) cached = null;
      return data ?? null;
    });
  return inflight;
}

export function useActiveCycle() {
  const [state, setState] = useState(cached);

  useEffect(() => {
    listeners.add(setState);
    if (!cached) refreshActiveCycle();
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return { cycle: state?.cycle ?? null, loading: !state, error: state?.error ?? null, reload: refreshActiveCycle };
}
