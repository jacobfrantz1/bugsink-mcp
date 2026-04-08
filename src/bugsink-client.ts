/**
 * Bugsink API Client
 *
 * Client for interacting with Bugsink's REST API.
 * API docs: https://www.bugsink.com/blog/bugsink-2.0-api/
 */

export interface BugsinkConfig {
  baseUrl: string;
  apiToken: string;
}

export interface PaginatedResponse<T> {
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Project {
  id: number;
  team: string;
  name: string;
  slug: string;
  dsn: string;
  digested_event_count: number;
  stored_event_count: number;
  alert_on_new_issue: boolean;
  alert_on_regression: boolean;
  alert_on_unmute: boolean;
  visibility: string;
  retention_max_event_count: number;
}

export interface Team {
  id: string;
  name: string;
  visibility: string;
}

export interface Issue {
  id: string;
  project: number;
  digest_order: number;
  first_seen: string;
  last_seen: string;
  digested_event_count: number;
  stored_event_count: number;
  calculated_type: string;
  calculated_value: string;
  transaction: string;
  is_resolved: boolean;
  is_resolved_by_next_release: boolean;
  is_muted: boolean;
}

export interface StackFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
}

export interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: {
    frames: StackFrame[];
  };
}

export interface EventData {
  exception?: {
    values?: ExceptionValue[];
  };
  message?: string;
  level?: string;
  platform?: string;
  tags?: Record<string, string>;
  contexts?: Record<string, unknown>;
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  browser?: {
    name?: string;
    version?: string;
  };
  os?: {
    name?: string;
    version?: string;
  };
}

export interface Event {
  id: string;
  event_id: string;
  issue: string;
  project: number;
  timestamp: string;
  ingested_at: string;
  digested_at: string;
  digest_order: number;
  grouping: number;
  data?: EventData;
  stacktrace_md?: string;
}

export interface Release {
  id: string;
  project: number;
  version: string;
  date_released: string;
  semver?: string;
  is_semver?: boolean;
  sort_epoch?: number;
}

export interface CreateProjectInput {
  team: string;
  name: string;
  visibility?: 'joinable' | 'discoverable' | 'team_members';
  alert_on_new_issue?: boolean;
  alert_on_regression?: boolean;
  alert_on_unmute?: boolean;
  retention_max_event_count?: number;
}

export interface UpdateProjectInput {
  name?: string;
  visibility?: 'joinable' | 'discoverable' | 'team_members';
  alert_on_new_issue?: boolean;
  alert_on_regression?: boolean;
  alert_on_unmute?: boolean;
  retention_max_event_count?: number;
}

export interface CreateTeamInput {
  name: string;
  visibility?: 'joinable' | 'discoverable' | 'hidden';
}

export interface UpdateTeamInput {
  name?: string;
  visibility?: 'joinable' | 'discoverable' | 'hidden';
}

export interface CreateReleaseInput {
  project: number;
  version: string;
  timestamp?: string;
}

// ============================================================================
// Composite cursor — bridges Bugsink's server-page cursor with client-side
// `limit` slicing so that paginating with a small limit doesn't silently skip
// items inside a server page.
//
// A composite cursor encodes:
//   c: the Bugsink server cursor for the page that contains the next item
//      (null = first page)
//   o: the offset within that filtered page where the next item begins.
//      A negative value means "from the end" (used by `previous` cursors so we
//      can resume reading from the tail of the prior server page without
//      having to know its length up front).
//
// The encoded form is base64url(JSON), wrapped in a fake `?cursor=` URL so it
// flows through the same `next`/`previous` URL plumbing the API uses.
// ============================================================================

interface CompositeCursor {
  c: string | null;
  o: number;
}

const COMPOSITE_URL_PREFIX = 'http://composite.local/?cursor=';

function encodeCompositeCursor(cursor: CompositeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCompositeCursor(token: string): CompositeCursor {
  let json: string;
  try {
    json = Buffer.from(token, 'base64url').toString('utf-8');
  } catch {
    throw new Error('Invalid cursor: not valid base64url');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid cursor: not valid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { o: unknown }).o !== 'number' ||
    ((parsed as { c: unknown }).c !== null && typeof (parsed as { c: unknown }).c !== 'string')
  ) {
    throw new Error('Invalid cursor: malformed structure');
  }
  return parsed as CompositeCursor;
}

function extractCursorFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('cursor');
  } catch {
    return null;
  }
}

function compositeToUrl(cursor: CompositeCursor | null): string | null {
  return cursor ? `${COMPOSITE_URL_PREFIX}${encodeCompositeCursor(cursor)}` : null;
}

/**
 * Paginate a Bugsink list endpoint with client-side filtering and `limit`
 * slicing, while keeping pagination correct across server-page boundaries.
 *
 * `fetchServerPage` is called with a server cursor (or null for the first
 * page) and must return a raw `PaginatedResponse<T>`. `filter` is applied to
 * each fetched server page before slicing.
 *
 * To fill `limit` when the slice straddles a server page boundary, this helper
 * may fetch a second server page in a single call. Beyond that it stops, so
 * `limit` larger than ~2x the server page size will be under-filled (the
 * returned `next` cursor still works to continue).
 */
async function paginateWithLimit<T>(
  fetchServerPage: (serverCursor: string | null) => Promise<PaginatedResponse<T>>,
  filter: (items: T[]) => T[],
  limit: number,
  inputCursor: string | undefined,
): Promise<PaginatedResponse<T>> {
  const composite = inputCursor ? decodeCompositeCursor(inputCursor) : null;
  const startServerCursor = composite?.c ?? null;
  let startOffset = composite?.o ?? 0;

  const startPage = await fetchServerPage(startServerCursor);
  const filteredStart = filter(startPage.results);

  // Resolve negative offset (from end) into a concrete index
  if (startOffset < 0) {
    startOffset = Math.max(0, filteredStart.length + startOffset);
  } else {
    startOffset = Math.min(startOffset, filteredStart.length);
  }

  let results = filteredStart.slice(startOffset, startOffset + limit);

  // State describing where this user-page ended, used to compute `next`
  let endServerCursor: string | null = startServerCursor;
  let endPage: PaginatedResponse<T> = startPage;
  let endFiltered: T[] = filteredStart;
  let endOffset = startOffset + results.length;

  // If we didn't fill `limit`, spill into one more server page
  if (results.length < limit && startPage.next) {
    const nextServerCursor = extractCursorFromUrl(startPage.next);
    if (nextServerCursor !== null) {
      const nextPage = await fetchServerPage(nextServerCursor);
      const filteredNext = filter(nextPage.results);
      const needed = limit - results.length;
      const fromNext = filteredNext.slice(0, needed);
      results = results.concat(fromNext);
      endServerCursor = nextServerCursor;
      endPage = nextPage;
      endFiltered = filteredNext;
      endOffset = fromNext.length;
    }
  }

  // Compute forward (`next`) cursor
  let nextComposite: CompositeCursor | null = null;
  if (endOffset < endFiltered.length) {
    nextComposite = { c: endServerCursor, o: endOffset };
  } else if (endPage.next) {
    const nextCursor = extractCursorFromUrl(endPage.next);
    if (nextCursor !== null) {
      nextComposite = { c: nextCursor, o: 0 };
    }
  }

  // Compute backward (`previous`) cursor
  let prevComposite: CompositeCursor | null = null;
  if (startOffset > 0) {
    prevComposite = { c: startServerCursor, o: Math.max(0, startOffset - limit) };
  } else if (startPage.previous) {
    const prevCursor = extractCursorFromUrl(startPage.previous);
    if (prevCursor !== null) {
      // Negative offset = "from the end of that page", resolved on next call.
      prevComposite = { c: prevCursor, o: -limit };
    }
  }

  return {
    results,
    next: compositeToUrl(nextComposite),
    previous: compositeToUrl(prevComposite),
  };
}

export class BugsinkClient {
  private baseUrl: string;
  private apiToken: string;

  constructor(config: BugsinkConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiToken = config.apiToken;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/canonical/0${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bugsink API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * List all projects
   */
  async listProjects(options?: { cursor?: string }): Promise<PaginatedResponse<Project>> {
    const params = new URLSearchParams();
    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }
    const qs = params.toString();
    return this.fetch<PaginatedResponse<Project>>(`/projects/${qs ? `?${qs}` : ''}`);
  }

  /**
   * Get a specific project by ID
   */
  async getProject(projectId: number): Promise<Project> {
    return this.fetch<Project>(`/projects/${projectId}/`);
  }

  /**
   * List all teams
   */
  async listTeams(options?: { cursor?: string }): Promise<PaginatedResponse<Team>> {
    const params = new URLSearchParams();
    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }
    const qs = params.toString();
    return this.fetch<PaginatedResponse<Team>>(`/teams/${qs ? `?${qs}` : ''}`);
  }

  /**
   * List issues for a project.
   *
   * Bugsink's API only supports cursor-based pagination and exposes no `status`
   * filter (per the OpenAPI spec: only `cursor`, `project`, `sort`, `order` are
   * accepted). `limit` and `status` are enforced client-side via the composite
   * cursor helper, so paginating with a small `limit` walks through items
   * correctly across server-page boundaries.
   */
  async listIssues(projectId: number, options?: {
    status?: string;
    limit?: number;
    sort?: 'digest_order' | 'last_seen';
    order?: 'asc' | 'desc';
    cursor?: string;
  }): Promise<PaginatedResponse<Issue>> {
    const limit = options?.limit ?? 25;

    const fetchServerPage = (serverCursor: string | null) => {
      const params = new URLSearchParams();
      params.set('project', projectId.toString());
      if (options?.sort) params.set('sort', options.sort);
      if (options?.order) params.set('order', options.order);
      if (serverCursor) params.set('cursor', serverCursor);
      return this.fetch<PaginatedResponse<Issue>>(`/issues/?${params.toString()}`);
    };

    const filter = (items: Issue[]): Issue[] => {
      if (!options?.status) return items;
      const wanted = options.status.toLowerCase();
      return items.filter((issue) => {
        if (wanted === 'resolved') return issue.is_resolved;
        if (wanted === 'muted') return issue.is_muted;
        if (wanted === 'unresolved') return !issue.is_resolved && !issue.is_muted;
        return true;
      });
    };

    return paginateWithLimit(fetchServerPage, filter, limit, options?.cursor);
  }

  /**
   * Get a specific issue by ID
   */
  async getIssue(issueId: string): Promise<Issue> {
    return this.fetch<Issue>(`/issues/${issueId}/`);
  }

  /**
   * List events for an issue.
   *
   * Bugsink's API only supports cursor-based pagination (per the OpenAPI spec:
   * only `cursor`, `issue`, `order` are accepted). `limit` is enforced
   * client-side via the composite cursor helper, so paginating with a small
   * `limit` walks through events correctly across server-page boundaries.
   */
  async listEvents(issueId: string, options?: {
    limit?: number;
    cursor?: string;
  }): Promise<PaginatedResponse<Event>> {
    const limit = options?.limit ?? 10;

    const fetchServerPage = (serverCursor: string | null) => {
      const params = new URLSearchParams();
      params.set('issue', issueId);
      if (serverCursor) params.set('cursor', serverCursor);
      return this.fetch<PaginatedResponse<Event>>(`/events/?${params.toString()}`);
    };

    return paginateWithLimit(fetchServerPage, (items) => items, limit, options?.cursor);
  }

  /**
   * Get a specific event by ID
   */
  async getEvent(eventId: string): Promise<Event> {
    return this.fetch<Event>(`/events/${eventId}/`);
  }

  /**
   * Test connection to Bugsink instance
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const projects = await this.listProjects();
      return {
        success: true,
        message: `Connected successfully. Found ${projects.results.length} project(s).`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================================================
  // Mutation Methods
  // ============================================================================

  /**
   * Create a new project
   */
  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.fetch<Project>('/projects/', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /**
   * Update an existing project
   */
  async updateProject(projectId: number, input: UpdateProjectInput): Promise<Project> {
    return this.fetch<Project>(`/projects/${projectId}/`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  /**
   * Get a specific team by ID
   */
  async getTeam(teamId: string): Promise<Team> {
    return this.fetch<Team>(`/teams/${teamId}/`);
  }

  /**
   * Create a new team
   */
  async createTeam(input: CreateTeamInput): Promise<Team> {
    return this.fetch<Team>('/teams/', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /**
   * Update an existing team
   */
  async updateTeam(teamId: string, input: UpdateTeamInput): Promise<Team> {
    return this.fetch<Team>(`/teams/${teamId}/`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  // ============================================================================
  // Stacktrace Methods
  // ============================================================================

  /**
   * Get event stacktrace as pre-rendered Markdown
   */
  async getEventStacktrace(eventId: string): Promise<string> {
    const url = `${this.baseUrl}/api/canonical/0/events/${eventId}/stacktrace/`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bugsink API error (${response.status}): ${errorText}`);
    }

    return response.text();
  }

  // ============================================================================
  // Release Methods
  // ============================================================================

  /**
   * List releases for a project
   */
  async listReleases(projectId: number, options?: { cursor?: string }): Promise<PaginatedResponse<Release>> {
    const params = new URLSearchParams();
    params.set('project', projectId.toString());
    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }
    return this.fetch<PaginatedResponse<Release>>(`/releases/?${params.toString()}`);
  }

  /**
   * Get a specific release by ID
   */
  async getRelease(releaseId: string): Promise<Release> {
    return this.fetch<Release>(`/releases/${releaseId}/`);
  }

  /**
   * Create a new release
   */
  async createRelease(input: CreateReleaseInput): Promise<Release> {
    return this.fetch<Release>('/releases/', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
}
