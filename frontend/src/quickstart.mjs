import OpenAI from "openai";

const client = new OpenAI();
const events = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-6-luna",
    instructions: "Write clean code, run it, and report the actual output.",
  },
  environment: { type: "openai_hosted" },
  input:
    "Create tree.py, a Python script that prints a readable tree of the files in the current directory. Run it and show me the output.",
  stream: true,
});
events.withResultCollection();
try {
  for await (const event of events) {
    console.log(JSON.stringify(event));
  }
  const result = await events.finalResult();
  console.log(result.output_text);
  console.log("Session:", result.session_id);
} finally {
  events.controller.abort();
}