import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("student follow-up click never serializes a React event", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /onClick=\{latestComparison \? generateStudentFollowUp/);
  assert.match(source, /level === "beginner" \|\| level === "intermediate" \|\| level === "advanced"/);
  assert.match(source, /level: requestedLevel/);
  assert.match(source, /const latestTeacherPrompt = latestTeacherIndex >= 0/);
  assert.match(source, /responses: followUpResponses\.map/);
  assert.doesNotMatch(source, /selectedTeacherResponses\.map/);
  assert.match(source, /針對這段追問/);
  assert.match(source, /const followUpResponses = selectedFollowUps\.length > 0/);
  assert.match(source, /message\.audience !== "judge"/);
});

test("teaching verdict uses the independent Sol judge", async () => {
  const route = await readFile(new URL("../app/api/chat/teaching-evaluation/route.ts", import.meta.url), "utf8");
  const models = await readFile(new URL("../lib/openai.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(route, /getTeachingJudgeOpenAIModel\("gpt-5\.6-sol"\)/);
  assert.match(route, /runOpenAI\(openAiKey, judgeModel,/);
  assert.match(route, /output_text\?: unknown/);
  assert.match(route, /judgeInput, 1800, judgeSchema/);
  assert.match(route, /輸出在 JSON 完成前達到上限/);
  assert.match(models, /OPENAI_TEACHING_JUDGE_MODEL/);
  assert.match(page, /Sol 審判長評比/);
});
