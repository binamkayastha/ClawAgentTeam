const MAX_RELAY_DEPTH = 10;

const AGENT_REGISTRY = {};
let nextAgentId = 1;

function registerAgentName(name) {
  if (AGENT_REGISTRY[name] !== undefined) {
    return AGENT_REGISTRY[name];
  }

  const id = nextAgentId++;
  AGENT_REGISTRY[name] = id;
  return id;
}

function SUMMARY_INSTRUCTION(agentName) {
  return `You are ${agentName}.

When you finish a turn (user request or a teammate relay), end your response with exactly one final line prefixed with "Summary:" (plain text, no markdown heading).

- If you took concrete new action (code, design, tests, planning, etc.), use a one-line summary of what you did. Example: Summary: I updated the readme with the UI/UX diagram
- If a teammate relay ("From ...: Summary: ...") needs no action from you, do not do extra work; end with exactly: Summary: ACK — no action needed

You will receive teammate messages tagged with relay depth. Only respond with a substantive summary when there is real work to do; otherwise use the ACK line.`;
}

function isAckSummary(text) {
  return /^\s*ACK\s*[—-]\s*no action needed\s*$/i.test((text || "").trim());
}
