/** Shared enums and option lists. Must stay in sync with the Postgres enums. */

export const ROLES = {
  STUDENT: 'student',
  FACULTY: 'faculty',
  HOD: 'hod',
  CLUSTER_HEAD: 'cluster_head',
  ADMIN: 'admin'
};

export const ROLE_LABELS = {
  student: 'Student',
  faculty: 'Faculty Mentor',
  hod: 'Head of Department',
  cluster_head: 'Cluster Head',
  admin: 'Administrator'
};

/**
 * The categories a query can be raised under. Mirrors the query_category
 * enum (§10.9) — every value here must exist in Postgres, which is what
 * migration 0026 adds.
 *
 * The legacy values 'Academic', 'ERP/Tech' and 'Infrastructure' are
 * deliberately absent. They are still valid in the database (an enum value
 * cannot be dropped, and old queries carry them), so historical queries
 * still display and still read back correctly — they just cannot be chosen
 * any more, here or in the filter pills that share this list.
 */
export const QUERY_CATEGORIES = [
  'Academics',
  'Examination',
  'Behavioural',
  'Administrative',
  'Others'
];
export const QUERY_STATUSES = ['Open', 'In Progress', 'Resolved'];
export const QUERY_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

export const RESOLUTION_STATUS_LABELS = {
  none: 'Not resolved',
  pending_confirmation: 'Awaiting your confirmation',
  confirmed: 'Confirmed by student',
  reopened: 'Reopened by student'
};

export const ACHIEVEMENT_CATEGORIES = [
  { value: 'sports', label: 'Sports', icon: 'sports_cricket' },
  { value: 'cultural', label: 'Cultural', icon: 'theater_comedy' },
  { value: 'technical', label: 'Technical', icon: 'code' },
  { value: 'volunteering', label: 'Volunteering', icon: 'volunteer_activism' },
  { value: 'certification', label: 'Certification', icon: 'workspace_premium' },
  { value: 'leadership', label: 'Leadership', icon: 'groups' },
  { value: 'other', label: 'Other', icon: 'star' }
];

export const PARENT_OCCUPATIONS = [
  'Entrepreneur',
  'Family Business',
  'Public Sector',
  'Professional',
  'Govt. Employee',
  'Pvt. Company',
  'Home Maker'
];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * Course catalogue for the Cluster Head setup form's "Course name"
 * dropdown. Edit this one list to change what the department offers —
 * nothing else reads course names from anywhere. "Other" reveals a free
 * text field so an unlisted subject never blocks setup.
 */
export const COURSE_CATALOGUE = [
  'Programming for Problem Solving',
  'Data Structures and Algorithms',
  'Object Oriented Programming',
  'Database Management Systems',
  'Operating Systems',
  'Computer Networks',
  'Software Engineering',
  'Design and Analysis of Algorithms',
  'Discrete Mathematics',
  'Engineering Mathematics',
  'Digital Electronics',
  'Microcontrollers and Embedded Systems',
  'Internet of Things',
  'Sensors and Actuators',
  'Wireless Sensor Networks',
  'Cloud Computing',
  'Machine Learning',
  'Artificial Intelligence',
  'Data Science and Analytics',
  'Cyber Security',
  'Computer Organisation and Architecture',
  'Web Technologies',
  'Mobile Application Development',
  'Signals and Systems',
  'Control Systems',
  'Technical Communication',
  'Other'
];

export const OTHER_COURSE_OPTION = 'Other';

/** How many blank subject blocks the setup form starts with. */
export const CLUSTER_HEAD_DEFAULT_SUBJECT_ROWS = 5;

export const SEMESTER_OPTIONS = Array.from({ length: 8 }, (_, index) => ({
  value: String(index + 1),
  label: `Semester ${index + 1}`
}));

export const ACADEMIC_UPLOAD_LABELS = {
  attendance: 'Attendance',
  gpa: 'GPA',
  backlog: 'Backlogs',
  black_dot: 'Black dots'
};

/**
 * The 5-point scale printed on the departmental feedback form. Stored as
 * 1-5 in survey_response_answers so it can be averaged; these are the
 * labels the student actually sees.
 */
export const SURVEY_SCALE = [
  { value: 1, label: 'Poor' },
  { value: 2, label: 'Fair' },
  { value: 3, label: 'Satisfactory' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Excellent' }
];

/** The recurring jobs the HOD can fire on demand. Mirrors cycle_job_type. */
export const CYCLE_JOBS = [
  {
    value: 'at_risk_sweep',
    label: 'Re-evaluate at-risk students',
    icon: 'rule',
    description: 'Runs the attendance / GPA / backlog rule over every student and updates their flags.'
  },
  {
    value: 'at_risk_meeting_dispatch',
    label: 'Dispatch at-risk meetings',
    icon: 'event_available',
    description: 'Raises a mentor-owned meeting for each flagged student and notifies the mentor. Safe to run repeatedly.'
  },
  {
    value: 'survey_cycle',
    label: 'Open a new survey cycle',
    icon: 'ballot',
    description: 'Closes the current window, opens the next one and notifies every student.'
  },
  {
    value: 'survey_reminder_sweep',
    label: 'Send survey reminders',
    icon: 'notifications_active',
    description: 'Nudges only the students who have not yet answered the open survey.'
  }
];

export const AT_RISK_MEETING_STATUS_LABELS = {
  awaiting_link: 'Awaiting meeting link',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

/**
 * Counselling request states. A plain CHECK constraint in migration 0029,
 * not an enum — three fixed values driving a chip colour did not justify
 * their own migration file for the enum ordering hazard (§11.5).
 *
 * Student and mentor read the same row differently: "Sent" is what the
 * student needs to know, "Needs a reply" is what the mentor needs to do.
 */
export const COUNSELLING_STATUS = {
  open: {
    studentLabel: 'Sent',
    mentorLabel: 'Needs a reply',
    className: 'bg-error-container text-on-error-container'
  },
  acknowledged: {
    studentLabel: 'Mentor replied',
    mentorLabel: 'In conversation',
    className: 'bg-warning-container text-on-warning-container'
  },
  closed: {
    studentLabel: 'Closed',
    mentorLabel: 'Closed',
    className: 'bg-success-container text-on-success-container'
  }
};

/**
 * The kinds of counselling a student chooses from before describing the
 * issue, in the order the dropdown shows them. `value` is what is stored
 * (counselling_requests.counselling_type, migration 0040, whose CHECK and
 * counselling_type_label() hold the same twelve); `label` is what people
 * read. Requests sent before 0040 have no type.
 */
export const COUNSELLING_TYPES = [
  { value: 'academic', label: 'Academic Counselling' },
  { value: 'personal', label: 'Personal Counselling' },
  { value: 'career', label: 'Career Counselling' },
  { value: 'placement', label: 'Placement Counselling' },
  { value: 'financial', label: 'Financial Counselling' },
  { value: 'technical', label: 'Technical Counselling' },
  { value: 'health_wellness', label: 'Health & Wellness Counselling' },
  { value: 'behavioural', label: 'Behavioural Counselling' },
  { value: 'professional_development', label: 'Professional Development Counselling' },
  { value: 'higher_education', label: 'Higher Education Counselling' },
  { value: 'general_guidance', label: 'General Guidance & Mentorship' },
  { value: 'other', label: 'Other' }
];

const COUNSELLING_TYPE_LABELS = Object.fromEntries(COUNSELLING_TYPES.map((type) => [type.value, type.label]));

/** The display name of a stored counselling type; null for none. */
export const counsellingTypeLabel = (value) => (value ? COUNSELLING_TYPE_LABELS[value] ?? value : null);

/** Whom a query went to (support_queries.mentor_kind, migration 0042). */
export const MENTOR_KIND_LABELS = {
  faculty: 'Faculty Mentor',
  senior: 'Senior Mentor'
};

/** Who raised a query to the HOD or a faculty member (0042). */
export const RAISED_BY_LABELS = {
  faculty: 'Raised by faculty',
  senior: 'Raised by senior'
};

/**
 * The sections a senior mentor can look after: A3, A4 ... T3, T4, the
 * sections of the mentor-HOD sheet. The database stores them as "A 3"
 * (senior_mentor_sections, 0042) and shows them as "A3".
 */
export const SENIOR_SECTIONS = 'ABCDEFGHIJKLMNOPQRST'.split('').flatMap((letter) => [`${letter}3`, `${letter}4`]);

export const EMPLOYMENT_STATUS_LABELS = {
  active: 'Active',
  on_leave: 'On leave',
  departed: 'Departed'
};

export const CHART_COLORS = {
  open: '#dc2626',
  inProgress: '#d97706',
  resolved: '#16a34a',
  primary: '#c2410c',
  secondary: '#f97316',
  slate: '#a8a29e',
  series: ['#c2410c', '#f97316', '#a8a29e', '#ea580c', '#d97706', '#16a34a']
};

/**
 * The department screens, served under /hod and under /admin (see
 * lib/portalPaths.js). Same screens, same order; what each shows is
 * decided by the database.
 */
function departmentNavigation(base) {
  return [
    { to: base, label: 'Home', icon: 'home', end: true },
    { to: `${base}/queries`, label: 'All Queries', icon: 'inbox' },
    // Queries escalated to the HOD, by faculty or by a senior (0042). They
    // are not in All Queries.
    { to: `${base}/raised`, label: 'Raised to HOD', icon: 'flag' },
    { to: `${base}/performance`, label: 'Faculty Performance', icon: 'leaderboard' },
    { to: `${base}/reports`, label: 'Faculty Reports', icon: 'analytics' },
    { to: `${base}/roster`, label: 'Faculty Roster', icon: 'badge' },
    { to: `${base}/students`, label: 'Students', icon: 'school' },
    { to: `${base}/seniors`, label: 'Senior Mentors', icon: 'workspace_premium' },
    { to: `${base}/at-risk`, label: 'At-Risk Students', icon: 'e911_emergency' },
    { to: `${base}/cr-reports`, label: 'CR Reports', icon: 'description' },
    { to: `${base}/operations`, label: 'Scheduled Jobs', icon: 'settings_suggest' }
  ];
}

/**
 * Sidebar menu per role — the SLCM "MENU" list.
 * An item with `children` is a group: a heading that opens a sub-list,
 * open by default whenever the current page is under its `base`.
 * An item may carry a `when` predicate; it is only rendered if that returns
 * true for the signed-in profile. Form A is deliberately absent: it is a
 * one-time full-screen step before the portal opens, and afterwards it
 * lives inside My Profile rather than as a menu entry of its own.
 */
export const NAVIGATION = {
  student: [
    { to: '/student', label: 'Home', icon: 'home', end: true },
    { to: '/student/queries', label: 'My Queries', icon: 'confirmation_number' },
    // A senior mentor's extra pages (0042): the queries juniors send them,
    // with the live conversation and Ask HOD / Escalate, and their mentees.
    {
      to: '/student/peer-queries',
      label: 'Peer Queries',
      icon: 'forum',
      when: (profile) => Boolean(profile?.is_senior_mentor)
    },
    {
      to: '/student/senior-mentees',
      label: 'Assigned Mentees',
      icon: 'diversity_3',
      when: (profile) => Boolean(profile?.is_senior_mentor)
    },
    {
      to: '/student/group-queries',
      label: 'Group Queries',
      icon: 'groups',
      when: (profile) => Boolean(profile?.is_star_mentee)
    },
    { to: '/student/academics', label: 'Academics', icon: 'school' },
    { to: '/student/survey', label: 'Feedback Survey', icon: 'ballot' },
    {
      to: '/student/survey-tracking',
      label: 'Survey Tracking',
      icon: 'fact_check',
      when: (profile) => Boolean(profile?.is_star_mentee)
    },
    {
      to: '/student/cr-report',
      label: 'CR Report',
      icon: 'description',
      when: (profile) => Boolean(profile?.is_star_mentee)
    },
    { to: '/student/counselling', label: 'Counselling', icon: 'volunteer_activism' },
    { to: '/student/achievements', label: 'Achievements', icon: 'military_tech' },
    { to: '/student/profile', label: 'My Profile', icon: 'account_circle' }
  ],
  faculty: [
    { to: '/faculty', label: 'Home', icon: 'home', end: true },
    { to: '/faculty/queries', label: 'Query Queue', icon: 'inbox' },
    // Queries a senior mentor raised to this faculty member (0042).
    { to: '/faculty/raised', label: 'Raised to Me', icon: 'flag' },
    { to: '/faculty/mentees', label: 'My Mentees', icon: 'groups' },
    { to: '/faculty/at-risk', label: 'At-Risk Students', icon: 'e911_emergency' },
    { to: '/faculty/counselling', label: 'Counselling', icon: 'volunteer_activism' },
    { to: '/faculty/cr-reports', label: 'CR Reports', icon: 'description' },
    { to: '/faculty/report', label: 'My Report', icon: 'analytics' },
    { to: '/faculty/profile', label: 'My Profile', icon: 'account_circle' }
  ],
  // A HOD's department screens show the faculty mapped to them and those
  // faculty's mentees (migration 0039). Uploads is the cluster head's
  // portal inside the HOD's, without the subject list: subjects are read
  // from the attendance files.
  hod: [
    ...departmentNavigation('/hod'),
    {
      label: 'Uploads',
      icon: 'cloud_upload',
      base: '/hod/uploads',
      children: [
        { to: '/hod/uploads', label: 'Overview', icon: 'dashboard', end: true },
        { to: '/hod/uploads/cycles', label: 'Academic Cycles', icon: 'event_repeat' },
        { to: '/hod/uploads/attendance', label: 'Upload Attendance', icon: 'fact_check' },
        { to: '/hod/uploads/gpa', label: 'Upload GPA', icon: 'grade' },
        { to: '/hod/uploads/backlogs', label: 'Upload Backlogs', icon: 'assignment_late' },
        { to: '/hod/uploads/black-dots', label: 'Upload Black dot', icon: 'gavel' },
        { to: '/hod/uploads/rosters', label: 'Rosters & Mentors', icon: 'group_add' }
      ]
    },
    { to: '/hod/profile', label: 'My Profile', icon: 'account_circle' }
  ],
  // The administrator: the department screens for the whole department,
  // plus the mentor-HOD mapping upload.
  admin: [
    ...departmentNavigation('/admin'),
    { to: '/admin/upload', label: 'Upload', icon: 'upload_file' },
    { to: '/admin/profile', label: 'My Profile', icon: 'account_circle' }
  ],
  // Deliberately short. A Cluster Head uploads data and creates the
  // accounts that data attaches to — no queries, no student profiles, no
  // reports.
  cluster_head: [
    { to: '/cluster-head', label: 'Home', icon: 'home', end: true },
    // Where the year starts: the cycle, its semesters, and its workflow.
    { to: '/cluster-head/cycles', label: 'Academic Cycles', icon: 'event_repeat' },
    { to: '/cluster-head/attendance', label: 'Upload Attendance', icon: 'fact_check' },
    { to: '/cluster-head/gpa', label: 'Upload GPA', icon: 'grade' },
    { to: '/cluster-head/backlogs', label: 'Upload Backlogs', icon: 'assignment_late' },
    { to: '/cluster-head/black-dots', label: 'Upload Black dot', icon: 'gavel' },
    { to: '/cluster-head/courses', label: 'My Subjects', icon: 'menu_book' },
    { to: '/cluster-head/rosters', label: 'Rosters & Mentors', icon: 'group_add' },
    { to: '/cluster-head/profile', label: 'My Profile', icon: 'account_circle' }
  ]
};

export const HOME_PATH = {
  student: '/student',
  faculty: '/faculty',
  hod: '/hod',
  cluster_head: '/cluster-head',
  admin: '/admin'
};
