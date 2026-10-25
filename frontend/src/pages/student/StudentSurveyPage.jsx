/**
 * StudentSurveyPage
 * The 15-day mentor feedback survey. Goes to EVERY student, not just
 * flagged ones — this is a general pulse check and is entirely separate
 * from the at-risk workflow.
 *
 * One shared department-wide window is open at a time; the student either
 * has answered it or has not. Answers are immutable once submitted, which
 * is what makes the completion count the rep and the mentor see meaningful.
 */

import { useCallback, useEffect, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { describeError, formatDate, formatDateTime } from '../../lib/formatters.js';
import { SURVEY_SCALE } from '../../lib/constants.js';

export default function StudentSurveyPage() {
  const toast = useToast();
  const { run, pending } = useAsyncAction();

  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [showMissing, setShowMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_active_survey_for_student');
    if (error) toast.error(describeError(error));
    setSurvey(data ?? null);
    setAnswers({});
    setShowMissing(false);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const questions = survey?.questions ?? [];
  const answered = questions.filter((q) => answers[q.question_number]).length;
  const complete = questions.length > 0 && answered === questions.length;

  const submit = (event) => {
    event.preventDefault();
    if (!complete) {
      setShowMissing(true);
      toast.warning('Please answer every question before submitting.');
      return;
    }

    run(
      async () => {
        const { error } = await supabase.rpc('submit_survey_response', {
          p_cycle_id: survey.cycle.id,
          p_answers: questions.map((question) => ({
            question_number: question.question_number,
            rating: answers[question.question_number]
          }))
        });
        if (error) throw error;
      },
      { successMessage: 'Thank you — your feedback has been recorded.', onSuccess: load }
    );
  };

  if (loading) {
    return (
      <PortalShell>
        <PageHeader title="Mentor feedback survey" />
        <SkeletonCards count={3} />
      </PortalShell>
    );
  }

  if (!survey?.cycle) {
    return (
      <PortalShell>
        <PageHeader title="Mentor feedback survey" />
        <Panel>
          <EmptyState
            icon="ballot"
            title="No survey is open right now"
            description="A new survey opens every 15 days. You will get a notification when the next one is available."
          />
        </Panel>
      </PortalShell>
    );
  }

  if (survey.has_submitted) {
    return (
      <PortalShell>
        <PageHeader
          title="Mentor feedback survey"
          subtitle={`Survey #${survey.cycle.cycle_number} · closes ${formatDate(survey.cycle.closes_on)}`}
        />
        <Panel>
          <EmptyState
            icon="task_alt"
            title="You have already filled this one in"
            description={`Submitted ${formatDateTime(survey.submitted_at)}. The next survey opens in the following cycle.`}
          />
        </Panel>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <PageHeader
        title="Mentor feedback survey"
        subtitle={`Survey #${survey.cycle.cycle_number} · open until ${formatDate(survey.cycle.closes_on)} · about a minute to complete`}
      />

      <form onSubmit={submit} noValidate>
        <Panel className="mb-4" tab="How it works" tabIcon="info">
          <p className="text-body-sm text-on-surface-variant">
            Rate each statement on a five-point scale. Your individual answers go to your mentor and the
            department; the student representative only sees whether you have submitted, never what you
            said.
          </p>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${questions.length ? (answered / questions.length) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-2 text-label-sm text-tertiary">
            {answered} of {questions.length} answered
          </p>
        </Panel>

        <div className="space-y-3">
          {questions.map((question) => {
            const value = answers[question.question_number];
            const missing = showMissing && !value;
            return (
              <Panel key={question.question_number}>
                <fieldset>
                  <legend className="text-body-sm text-on-surface">
                    <span className="mr-1.5 text-tertiary">{question.question_number}.</span>
                    {question.prompt}
                  </legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-5">
                    {SURVEY_SCALE.map((option) => {
                      const checked = value === option.value;
                      return (
                        <label
                          key={option.value}
                          className={`flex cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-body-sm transition-colors ${
                            checked
                              ? 'border-primary bg-primary-fixed/60 text-on-primary-fixed'
                              : 'border-outline-variant hover:bg-surface-container-low'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`question-${question.question_number}`}
                            value={option.value}
                            checked={checked}
                            onChange={() =>
                              setAnswers((current) => ({
                                ...current,
                                [question.question_number]: option.value
                              }))
                            }
                            className="text-primary focus:ring-primary"
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                  {missing && <p className="field-error">Please choose one.</p>}
                </fieldset>
              </Panel>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-label-sm text-tertiary">Answers cannot be changed once submitted.</p>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? 'Submitting...' : 'Submit feedback'}
          </button>
        </div>
      </form>
    </PortalShell>
  );
}
