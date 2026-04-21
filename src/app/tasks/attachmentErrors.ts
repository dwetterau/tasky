export const AGENT_ALREADY_ATTACHED_TO_TASK_ERROR = "Agent is already linked to this task";
export const AGENT_ALREADY_LINKED_ERROR = "Agent external ID already exists on another task";
export const PULL_REQUEST_ALREADY_ATTACHED_TO_TASK_ERROR = "Pull request is already linked to this task";
export const PULL_REQUEST_ALREADY_LINKED_ERROR = "Pull request is already linked to another task";
export const LINEAR_ISSUE_ALREADY_ATTACHED_TO_TASK_ERROR = "Linear issue is already linked to this task";
export const LINEAR_ISSUE_ALREADY_LINKED_ERROR = "Linear issue is already linked to another task";

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return null;
}

export function getAgentAttachmentErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);
  if (!message) {
    return "Couldn't attach this agent. Try again.";
  }
  if (message.includes(AGENT_ALREADY_ATTACHED_TO_TASK_ERROR)) {
    return "This agent is already linked to this task.";
  }
  if (message.includes(AGENT_ALREADY_LINKED_ERROR)) {
    return "This agent is already linked to another task.";
  }
  return message;
}

export function getPullRequestAttachmentErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);
  if (!message) {
    return "Couldn't attach this pull request. Try again.";
  }
  if (message.includes(PULL_REQUEST_ALREADY_ATTACHED_TO_TASK_ERROR)) {
    return "This pull request is already linked to this task.";
  }
  if (message.includes(PULL_REQUEST_ALREADY_LINKED_ERROR)) {
    return "This pull request is already linked to another task.";
  }
  if (
    message.includes("Invalid pull request URL") ||
    message.includes("Only github.com pull request URLs are supported") ||
    message.includes("Only github.com pull request URLs and review.cursor.com/github/pr links are supported") ||
    message.includes("URL must match github.com/<owner>/<repo>/pull/<number>")
  ) {
    return "Enter a GitHub PR URL like github.com/owner/repo/pull/123 or review.cursor.com/github/pr/owner/repo/123.";
  }
  return message;
}

export function getLinearIssueAttachmentErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);
  if (!message) {
    return "Couldn't attach this Linear issue. Try again.";
  }
  if (message.includes(LINEAR_ISSUE_ALREADY_ATTACHED_TO_TASK_ERROR)) {
    return "This Linear issue is already linked to this task.";
  }
  if (message.includes(LINEAR_ISSUE_ALREADY_LINKED_ERROR)) {
    return "This Linear issue is already linked to another task.";
  }
  if (
    message.includes("Invalid Linear issue URL") ||
    message.includes("Only linear.app issue URLs are supported") ||
    message.includes("URL must match linear.app/<workspace>/issue/<identifier>")
  ) {
    return "Enter a Linear issue URL like linear.app/team/issue/ENG-123.";
  }
  return message;
}
