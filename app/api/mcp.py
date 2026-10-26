"""MCP 2025-11-25 兼容的只读无会话 JSON HTTP 传输，复用公开数据契约。"""

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.schemas.event import EventKind, EventPhase
from app.services import events, monitor, reset_forecast

router = APIRouter()
VERSION = "2025-11-25"


class EventArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    limit: int = Field(default=20, ge=1, le=100)
    kind: Optional[EventKind] = None
    phase: Optional[EventPhase] = None
    account: Optional[str] = Field(default=None, min_length=1, max_length=100)


TOOLS = [
    {
        "name": name,
        "description": description,
        "inputSchema": schema,
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    }
    for name, description, schema in [
        (
            "get_monitor_status",
            "Public data freshness and source health; no private logs or credentials.",
            {"type": "object", "properties": {}, "additionalProperties": False},
        ),
        (
            "get_reset_events",
            "Independent public reset events and original sources; never personal account quota.",
            EventArguments.model_json_schema(),
        ),
        (
            "get_reset_forecast",
            "Conservative current announcement window, evidence and limitations; reading does not call AI.",
            {"type": "object", "properties": {}, "additionalProperties": False},
        ),
    ]
]


def error(identifier, code: int, message: str, status: int = 200):
    return JSONResponse(
        {"jsonrpc": "2.0", "id": identifier, "error": {"code": code, "message": message}}, status_code=status
    )


@router.post("/mcp")
async def endpoint(request: Request):
    if "application/json" not in request.headers.get("accept", "*/*") and "*/*" not in request.headers.get(
        "accept", "*/*"
    ):
        return error(None, -32600, "application/json response required", 406)
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        return error(None, -32600, "Origin not allowed", 403)
    if "application/json" not in request.headers.get("content-type", ""):
        return error(None, -32600, "application/json required", 415)
    if request.headers.get("mcp-protocol-version", VERSION) not in {VERSION, "2025-06-18", "2025-03-26"}:
        return error(None, -32600, "Unsupported protocol version", 400)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 16384:
            return error(None, -32600, "Request too large", 413)
    try:
        value = json.loads(body)
    except (ValueError, UnicodeError):
        return error(None, -32700, "Invalid JSON")
    if not isinstance(value, dict) or value.get("jsonrpc") != "2.0" or not isinstance(value.get("method"), str):
        return error(None, -32600, "Invalid JSON-RPC request")
    identifier, method = value.get("id"), value["method"]
    if identifier is not None and (isinstance(identifier, bool) or not isinstance(identifier, (str, int))):
        return error(None, -32600, "Invalid request id")
    if "id" not in value:
        return Response(status_code=202)
    params = value.get("params", {})
    if not isinstance(params, dict):
        return error(identifier, -32602, "Invalid params")
    cfg = request.app.state.cfg
    result: dict[str, Any]
    if method == "initialize":
        result = {
            "protocolVersion": VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "codex-reset-monitor-readonly", "version": "1.0.0"},
            "instructions": "Public announcements only. No personal quota, write operations, AI invocation or notification delivery.",
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments", {})
        try:
            if name == "get_reset_events":
                args = EventArguments.model_validate(arguments)
                output = (await events.page(cfg, **args.model_dump())).model_dump(mode="json")
            elif name in {"get_monitor_status", "get_reset_forecast"}:
                if arguments != {}:
                    return error(identifier, -32602, "This tool accepts no arguments")
                output = (
                    (await monitor.summary(cfg)).model_dump(mode="json")
                    if name == "get_monitor_status"
                    else (await reset_forecast.snapshot(cfg, datetime.now(timezone.utc))).model_dump(mode="json")
                )
            else:
                return error(identifier, -32602, "Unknown read-only tool")
        except ValidationError:
            return error(identifier, -32602, "Invalid tool arguments")
        except Exception:
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": identifier,
                    "result": {
                        "content": [{"type": "text", "text": "Public data temporarily unavailable"}],
                        "isError": True,
                    },
                }
            )
        result = {
            "content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}],
            "structuredContent": output,
            "isError": False,
        }
    else:
        return error(identifier, -32601, "Method not found")
    return JSONResponse({"jsonrpc": "2.0", "id": identifier, "result": result}, headers={"Cache-Control": "no-store"})
