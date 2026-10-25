/**
 * uploadedSubjects
 * A HOD's subjects in the active cycle (migration 0039).
 *
 * A cluster head keeps a subject list (My Subjects) and every attendance
 * upload must match one of them. A HOD keeps none: an attendance file's
 * Course Code and Course Name are read from the file, and the subject is
 * created the first time that code is uploaded in the cycle. So a HOD's
 * "subjects" are simply the ones their attendance uploads were filed
 * under — which this reads back.
 */

import { supabase } from './supabaseClient.js';

export async function fetchUploadedSubjects(uploaderId, cycleId) {
  if (!uploaderId || !cycleId) return { data: [], error: null };

  const { data: batches, error } = await supabase
    .from('academic_upload_batches')
    .select('course_id')
    .eq('cycle_id', cycleId)
    .eq('upload_type', 'attendance')
    .eq('uploaded_by', uploaderId)
    .not('course_id', 'is', null);
  if (error) return { data: [], error };

  const ids = [...new Set((batches ?? []).map((batch) => batch.course_id))];
  if (!ids.length) return { data: [], error: null };

  const { data, error: courseError } = await supabase
    .from('current_cycle_courses')
    .select('id, course_name, course_code')
    .in('id', ids)
    .order('course_code');
  return { data: data ?? [], error: courseError ?? null };
}
