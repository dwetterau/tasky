export type BriefingContent = {
  title: string;
  body: string;
};

const LEADING_HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/;

export function splitBriefingMarkdown(markdown: string): BriefingContent {
  const lines = markdown.split(/\r?\n/);
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine === -1) {
    return { title: "Briefing", body: markdown };
  }

  const heading = lines[firstContentLine]?.match(LEADING_HEADING);
  const title = heading?.[1]?.trim();
  if (!title) {
    return { title: "Briefing", body: markdown };
  }

  const bodyLines = lines.slice(firstContentLine + 1);
  while (bodyLines[0]?.trim() === "") {
    bodyLines.shift();
  }
  return {
    title,
    body: bodyLines.join("\n"),
  };
}
