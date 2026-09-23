# Bugsink MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for interacting with [Bugsink](https://www.bugsink.com/) error tracking via LLMs.

This server enables AI assistants like Claude, Cursor, and other MCP-compatible tools to query and analyze errors from your Bugsink instance.

## Features

- **List Projects** - View all projects in your Bugsink instance, optionally by team
- **List Teams** - View all teams
- **List Issues** - Query grouped error occurrences by project, sorted by creation, recency, or event count
- **Get Issue Details** - Retrieve detailed issue information (by UUID or friendly ID)
- **Analyze Issue** - Issue details, recent events, and rendered stacktrace in one call
- **List Events** - View individual error occurrences with stacktraces
- **Get Event Details** - Full event data including tags and contexts
- **Get Stacktrace** - Pre-rendered Markdown stacktrace for an event
- **Triage Issues** - Resolve, reopen, mute (indefinitely, for a period, or until a volume threshold), unmute, delete
- **Comment on Issues** - Add notes to an issue's timeline
- **Manage Projects, Teams, Releases** - Create and update projects/teams, create and list releases
- **Test Connection** - Verify API connectivity

Requires Bugsink **2.2.1 or newer** for the triage and comment tools (2.4.0 for `reopen_issue`, 2.5.0 for sorting by event count). Everything else works on any 2.x release.

## Installation

### Via npx (Recommended)

```bash
npx bugsink-mcp
```

### Global Install

```bash
npm install -g bugsink-mcp
```

### From Source

```bash
git clone https://github.com/j-shelfwood/bugsink-mcp.git
cd bugsink-mcp
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BUGSINK_URL` | Yes | Your Bugsink instance URL (e.g., `https://error-tracking.example.com`) |
| `BUGSINK_TOKEN` | Yes | API token for authentication |

### Generating an API Token

```bash
# Via Bugsink management command
bugsink-manage create_auth_token
```

Or through the Bugsink web UI under Settings > API Tokens.

#### Scoped tokens (Bugsink >= 2.6.0)

Bugsink 2.6.0 introduced tokens with an explicit set of capabilities, optionally limited to one project. Tokens created before 2.6.0 keep full access. If you create a new token for this server, grant the capabilities for the tools you intend to use:

| Capability | Tools |
|------------|-------|
| `projects:read` | `list_projects`, `get_project`, `test_connection` |
| `projects:manage` | `create_project`, `update_project` |
| `teams:read` | `list_teams` |
| `teams:manage` | `create_team`, `update_team` |
| `issues:read` | `list_issues`, `get_issue`, `analyze_issue_context` |
| `events:read` | `list_events`, `get_event`, `get_stacktrace`, `analyze_issue_context` |
| `issues:triage` | `resolve_issue`, `reopen_issue`, `mute_issue`, `unmute_issue` |
| `issues:comment` | `comment_on_issue` |
| `issues:delete` | `delete_issue` |
| `releases:read` | `list_releases`, `get_release` |
| `releases:create` | `create_release` |

Project and team capabilities are installation-wide only, so a token limited to a single project cannot use `list_projects` (and therefore `test_connection`); the issue, event, and release tools still work for that project.

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop configuration (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bugsink": {
      "command": "npx",
      "args": ["bugsink-mcp"],
      "env": {
        "BUGSINK_URL": "https://your-bugsink-instance.com",
        "BUGSINK_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add bugsink -- npx bugsink-mcp
```

Then set environment variables in your shell or `.env` file.

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "bugsink": {
      "command": "npx",
      "args": ["bugsink-mcp"],
      "env": {
        "BUGSINK_URL": "https://your-bugsink-instance.com",
        "BUGSINK_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Available Tools

### `test_connection`
Test connectivity to your Bugsink instance.

### `list_projects`
List all projects in the Bugsink instance.

### `get_project`
Get detailed information about a specific project including DSN.

**Parameters:**
- `project_id` (number, required): The project ID

### `list_teams`
List all teams in the Bugsink instance.

### `list_issues`
List issues for a specific project.

**Parameters:**
- `project_id` (number, required): The project ID
- `status` (string, optional): Filter by status ('unresolved', 'resolved', 'muted')
- `limit` (number, optional): Max results (default: 25)
- `sort` (string, optional): 'digest_order' (default), 'last_seen', or 'digested_event_count'
- `order` (string, optional): 'asc' (default) or 'desc'
- `cursor` (string, optional): Pagination cursor from a previous response

Issue IDs below accept either the UUID or the friendly ID shown in the Bugsink UI (e.g. `PROD-QUASAR-SITE-42`).

### `get_issue`
Get detailed information about a specific issue.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

### `analyze_issue_context`
Issue details, the five most recent events, and the latest event's rendered stacktrace in one call.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

### `list_events`
List events (individual error occurrences) for a specific issue, newest first by default.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `limit` (number, optional): Max results (default: 10)
- `order` (string, optional): 'desc' (default, newest first) or 'asc'
- `cursor` (string, optional): Pagination cursor from a previous response

### `get_event`
Get detailed event information including full stacktrace.

**Parameters:**
- `event_id` (string, required): The event ID

### `get_stacktrace`
Get an event's stacktrace as pre-rendered Markdown.

**Parameters:**
- `event_id` (string, required): The event ID

### `resolve_issue`
Mark an issue as resolved.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `mode` (string, optional): 'now' (default), 'next_release', or 'latest_release'

### `reopen_issue`
Reopen a resolved issue.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

### `mute_issue`
Mute an issue indefinitely, for a period, or until a volume threshold is hit.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `period_name` (string, optional): 'minute', 'hour', 'day', 'week', 'month', or 'year'
- `nr_of_periods` (number, optional): Number of periods (required with `period_name`)
- `gte_threshold` (number, optional): Unmute once this many events arrive within the period

### `unmute_issue`
Unmute a muted issue.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

### `delete_issue`
Permanently delete an issue and its events. Not reversible.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

### `comment_on_issue`
Add a comment to an issue's timeline.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `comment` (string, required): The comment text

### `create_project`, `update_project`, `create_team`, `update_team`
Create or update projects and teams. `update_project` cannot move a project to another team.

### `list_releases`, `get_release`, `create_release`
List, inspect, and create releases for a project.

## Example Usage

Once configured, you can ask your AI assistant:

- "List all projects in Bugsink"
- "Show me the most frequent unresolved issues for project 1"
- "Analyze PROD-QUASAR-SITE-42 and tell me the root cause"
- "Mute that issue for 3 days"
- "Resolve it in the next release and add a comment linking the fix"

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## API Compatibility

This server is designed for [Bugsink](https://www.bugsink.com/), a self-hosted error tracking platform. Bugsink uses its own REST API (`/api/canonical/0/`) which is different from Sentry's API.

**Note:** This server does NOT work with Sentry or Sentry-hosted services. For Sentry, use the official [sentry-mcp](https://github.com/getsentry/sentry-mcp) server.

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/j-shelfwood/bugsink-mcp).
