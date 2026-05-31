#!/usr/bin/env python3
"""
Reads JSON events from stdin and logs PI agent traces to Weights & Biases Weave.
Spawned automatically by the Electron app when the first agent is created.

Required env vars:
  WANDB_API_KEY  - your W&B API key (https://wandb.ai/authorize)

Optional:
  WANDB_PROJECT  - W&B project name (default: clawagentteam)
"""

import json
import os
import sys

import weave

PROJECT = os.environ.get("WANDB_PROJECT", "clawagentteam")

try:
    weave.init(PROJECT)
    print(f"[weave] Initialized project '{PROJECT}'", file=sys.stderr)
except Exception as exc:
    print(f"[weave] Failed to initialize: {exc}", file=sys.stderr)
    sys.exit(1)

# Per-agent session state
# { agentId: { role, model, current_turn: { user_message, response_parts, tools_used } } }
sessions = {}


@weave.op()
def pi_agent_turn(
    agent_id: str,
    role: str,
    model: str,
    user_message: str,
    response: str,
    tools_used: list,
) -> dict:
    """One complete PI agent turn: user prompt → full assistant response."""
    return {"response": response, "tools_used": tools_used}


def get_session(agent_id: str, event: dict) -> dict:
    if agent_id not in sessions:
        sessions[agent_id] = {
            "role": event.get("role", "Pi Agent"),
            "model": event.get("model", "unknown"),
            "current_turn": None,
        }
    return sessions[agent_id]


def process_event(event: dict) -> None:
    agent_id = event.get("agentId")
    event_type = event.get("type")
    if not agent_id or not event_type:
        return

    session = get_session(agent_id, event)

    # Keep metadata up-to-date
    if event.get("role"):
        session["role"] = event["role"]
    if event.get("model"):
        session["model"] = event["model"]

    if event_type == "user_message":
        # New turn starts with the user's message
        session["current_turn"] = {
            "user_message": event.get("text", ""),
            "response_parts": [],
            "tools_used": [],
        }

    elif event_type == "agent_start":
        # Ensure a turn exists even if the user_message event was missed
        if not session["current_turn"]:
            session["current_turn"] = {
                "user_message": "",
                "response_parts": [],
                "tools_used": [],
            }

    elif event_type == "message_update":
        if session["current_turn"] and event.get("delta"):
            session["current_turn"]["response_parts"].append(event["delta"])

    elif event_type == "tool_execution_end":
        if session["current_turn"]:
            session["current_turn"]["tools_used"].append({
                "name": event.get("toolName", ""),
                "result": event.get("result", ""),
            })

    elif event_type == "agent_end":
        turn = session.get("current_turn")
        if not turn:
            return
        response = "".join(turn["response_parts"])
        try:
            pi_agent_turn(
                agent_id=agent_id,
                role=session["role"],
                model=session["model"],
                user_message=turn["user_message"],
                response=response,
                tools_used=turn["tools_used"],
            )
        except Exception as exc:
            print(f"[weave] Failed to log turn: {exc}", file=sys.stderr)
        session["current_turn"] = None


def main() -> None:
    print("[weave] Logger ready, listening for events on stdin...", file=sys.stderr)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            event = json.loads(raw)
            process_event(event)
        except json.JSONDecodeError:
            pass
        except Exception as exc:
            print(f"[weave] Error processing event: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
