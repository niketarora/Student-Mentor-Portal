/**
 * SeniorMenteesPage — /student/senior-mentees
 * A senior mentor's Assigned Mentees (migration 0042): the students of the
 * sections a HOD gave them on the Senior Mentors page. A student's section
 * is their faculty mentor's section from the mentor-HOD sheet.
 *
 * Only what a senior needs: name, registration number, section, e-mail
 * and their queries to the senior. No contact or family details.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { FilterPills } from '../../components/ui/FormControls.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { describeError } from '../../lib/formatters.js';

const sectionCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export default function SeniorMenteesPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const [mentees, setMentees] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const [menteeResult, sectionResult] = await Promise.all([
      supabase.rpc('get_my_senior_mentees'),
      supabase.from('senior_mentor_sections').select('section').eq('senior_id', profile.id)
    ]);
    if (menteeResult.error) toast.error(describeError(menteeResult.error));
    setMentees(Array.isArray(menteeResult.data) ? menteeResult.data : []);
    setSections(
      (sectionResult.data ?? []).map((row) => row.section.replace(' ', '')).sort(sectionCollator.compare)
    );
    setLoading(false);
  }, [profile.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return mentees.filter((row) =>
      (section === 'all' || row.section === section)
      && (!term || [row.full_name, row.login_id, row.email].some((value) => value?.toLowerCase().includes(term)))
    );
  }, [mentees, section, search]);

  return (
    <PortalShell searchPlaceholder="Search mentees by name, registration no. or email..." onSearch={setSearch}>
      <PageHeader
        title="Assigned mentees"
        subtitle={
          sections.length
            ? `The students of your section${sections.length > 1 ? 's' : ''} ${sections.join(', ')}. They can send you queries from their portal.`
            : 'The students of the sections the HOD assigns you.'
        }
      />

      {!loading && sections.length > 1 && (
        <Panel tab="Section" tabIcon="filter_alt" className="mb-4">
          <FilterPills
            ariaLabel="Section"
            value={section}
            onChange={setSection}
            options={[
              { value: 'all', label: 'All', count: mentees.length },
              ...sections.map((code) => ({ value: code, label: code, count: mentees.filter((m) => m.section === code).length }))
            ]}
          />
        </Panel>
      )}

      {loading ? (
        <SkeletonTable rows={6} columns={5} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={[
              {
                key: 'full_name',
                header: 'Student',
                render: (row) => (
                  <span className="block min-w-[12rem]">
                    <span className="block text-on-surface">{row.full_name}</span>
                    <span className="block break-anywhere text-label-sm text-tertiary">{row.email}</span>
                  </span>
                )
              },
              { key: 'login_id', header: 'Registration no.', render: (row) => row.login_id ?? '—' },
              { key: 'section', header: 'Section', render: (row) => <span className="whitespace-nowrap">{row.section}</span> },
              { key: 'faculty_mentor', header: 'Faculty mentor', render: (row) => row.faculty_mentor ?? '—' },
              {
                key: 'queries',
                header: 'Queries to you',
                render: (row) =>
                  row.open_queries ? (
                    <span className="chip bg-error-container text-on-error-container">{row.open_queries} open</span>
                  ) : (
                    <span className="text-tertiary">{row.queries ? `${row.queries}, all resolved` : 'None'}</span>
                  )
              }
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                icon="diversity_3"
                title={sections.length ? 'Nobody matches' : 'No sections yet'}
                description={
                  sections.length
                    ? mentees.length
                      ? 'Try another section or clear the search.'
                      : 'No students are in your sections yet. A student belongs to the section of their faculty mentor.'
                    : 'Once the HOD assigns you one or more sections, their students appear here.'
                }
              />
            }
          />
        </Panel>
      )}
    </PortalShell>
  );
}
