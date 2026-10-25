import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { describeError } from '../lib/formatters.js';

/** Role-aware dashboard numbers from the get_dashboard_metrics() RPC. */
export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_dashboard_metrics');
    if (rpcError) setError(describeError(rpcError));
    else {
      setMetrics(data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { metrics, loading, error, reload: load };
}
