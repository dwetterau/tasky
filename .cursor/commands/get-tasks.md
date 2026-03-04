---
description: Get current tasks tagged Tasky via MCP
---

Use the `Tasky` MCP server to fetch current tasks that have the `Tasky` tag.

Call the `readTasks` tool with:

```json
{
  "includeClosed": false,
  "filterTag": "Tasky"
}
```

Return a concise checklist with:
- Task id
- Status
- Priority
- Due date (if present)
- First line summary of content
