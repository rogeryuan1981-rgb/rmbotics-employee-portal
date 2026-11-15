export type Material = {
  id: string;
  title: string;
  kind: "text" | "pdf" | "youtube";
  content: string;
};
export type Question = {
  id: string;
  kind: "single" | "multiple" | "boolean";
  prompt: string;
  options: string[];
  correct?: number[];
  explanation?: string;
  material_id: string;
  reference?: string;
};
export type CourseContent = {
  title: string;
  seconds: number;
  pass_score: number;
  question_count: number;
  minutes: number;
  cycle: "once" | "annual";
  departments: string[];
  start: string;
  end: string;
  materials: Material[];
  questions: Question[];
};
export type Course = {
  id: string;
  draft: CourseContent;
  published: CourseContent | null;
  active: boolean;
  version: number;
};
export type Source = {
  source_key: string;
  label: string;
  active: boolean;
  due: string;
};
export type Requirement = {
  id: string;
  employee_id: string;
  course_id: string;
  course_version: number;
  cycle: string;
  batch: string;
  rules: { seconds: number; retest?: boolean };
  original_due: string;
  due: string;
  lifecycle: "active" | "cancelled" | "exempt";
  seconds: number;
  completed_at: string | null;
  completed_due: string | null;
  ever_overdue: boolean;
  conflict_pending: boolean;
  conflict_reason: string | null;
  cancellation_reason: string | null;
  course?: CourseContent;
  course_title?: string;
  is_open?: boolean;
  course_active?: boolean;
  sources: Source[];
  result?: Paper;
};
export type Paper = {
  id: string;
  questions: Question[];
  answers: Record<string, number[]>;
  expires_at: string | null;
  submitted_at: string | null;
  started_at: string;
  passed: boolean | null;
  score: number | null;
  pass_score: number;
  wrong_ids: string[];
  server_now: string;
};
export type Deadline = {
  mode: "hire" | "tenure" | "assigned" | "fixed";
  days: number;
  month: number;
  day: string;
  late: "makeup" | "exempt";
  makeup_days: number;
};
export type Link = { course_id: string; deadline: Deadline };
export type JobContent = {
  name: string;
  purpose: string;
  duties: { id: string; text: string; training: Link[] }[];
  training: Link[];
};
export type Job = {
  id: string;
  department_id: string;
  draft: JobContent;
  published: JobContent | null;
  version: number;
};
export type Person = {
  id: string;
  name: string;
  email: string;
  hire_date: string | null;
  department_id: string | null;
  active: boolean;
  inactive_reason?: string | null;
  systems: string[];
  tenures: { job_id: string; start_date: string; end_date: string | null }[];
};
export type Grant = {
  id: string;
  employee_id: string;
  system_code: string;
  role: "admin" | "hr" | "manager";
  department_id: string | null;
  all_departments: boolean;
};
export type System = {
  code: string;
  name: string;
  entry: string;
  admin_entry: string;
  enabled: boolean;
  sort_order: number;
};
export type Context = {
  employee: Person;
  systems: System[];
  grants: Grant[];
  server_now: string;
};
export type Notification = {
  id: string;
  kind: string;
  body: { title: string; due: string; entry: string };
  read_at: string | null;
};
export type AdminData = {
  departments: { id: string; name: string }[];
  employees: Person[];
  jobs: Job[];
  courses: Course[];
  requirements: Requirement[];
  issues: { id: string; message: string; resolution: string | null }[];
  settings: Settings | null;
  grants: Grant[];
  systems: System[];
};
export type Settings = {
  time: string;
  before: number[];
  overdue_every: number;
  hr_digest: boolean;
};
