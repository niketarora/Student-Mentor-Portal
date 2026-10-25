import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

export default function SatisfactionRating({ query, onRated }) {
  const { run, pending } = useAsyncAction();
  const [hovered, setHovered] = useState(0);

  if (query.status !== 'Resolved') return null;

  if (query.satisfaction_rating) {
    return (
      <p className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">
        You rated this
        <span className="flex" aria-label={`${query.satisfaction_rating} out of 5`}>
          {[1, 2, 3, 4, 5].map((star) => (
            <span
              key={star}
              className="material-symbols-outlined text-[18px] text-warning"
              style={{ fontVariationSettings: star <= query.satisfaction_rating ? "'FILL' 1" : "'FILL' 0" }}
              aria-hidden="true"
            >
              star
            </span>
          ))}
        </span>
      </p>
    );
  }

  const submit = (rating) =>
    run(
      async () => {
        const { error } = await supabase.rpc('rate_support_query', {
          p_query_id: query.id,
          p_rating: rating
        });
        if (error) throw error;
      },
      { successMessage: 'Thank you for your feedback!', onSuccess: onRated }
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-body-sm text-on-surface-variant">How was the support you received?</span>
      <div className="flex" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={pending}
            onMouseEnter={() => setHovered(star)}
            onClick={() => submit(star)}
            aria-label={`Rate ${star} out of 5`}
            className="p-0.5 text-warning disabled:opacity-50"
          >
            <span
              className="material-symbols-outlined text-[24px]"
              style={{ fontVariationSettings: star <= hovered ? "'FILL' 1" : "'FILL' 0" }}
              aria-hidden="true"
            >
              star
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
