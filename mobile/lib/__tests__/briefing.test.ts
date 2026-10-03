import { expect, test } from "@jest/globals";
import { splitBriefingMarkdown } from "../briefing";

test("promotes a leading heading into the briefing title", () => {
  const content = splitBriefingMarkdown(
    "# Saturday, Oct 3\n\n## Weather\nPartly sunny and dry.",
  );

  expect(content).toEqual({
    title: "Saturday, Oct 3",
    body: "## Weather\nPartly sunny and dry.",
  });
});

test("supports leading whitespace and optional closing heading markers", () => {
  expect(splitBriefingMarkdown("\n  ## Morning update ##\n\n- First item")).toEqual(
    {
      title: "Morning update",
      body: "- First item",
    },
  );
});

test("falls back to Briefing when the content has no leading heading", () => {
  const markdown = "Sunny today.\n\n## Calendar\n- Lunch";

  expect(splitBriefingMarkdown(markdown)).toEqual({
    title: "Briefing",
    body: markdown,
  });
});
