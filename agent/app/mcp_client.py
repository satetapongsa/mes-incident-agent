"""MCP client: connects to mcp-server over streamable HTTP."""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from . import config


class ToolError(Exception):
    pass


class McpTools:
    def __init__(self, session: ClientSession):
        self.session = session
        self.tools: list[Any] = []

    async def list_tools(self) -> list[Any]:
        res = await self.session.list_tools()
        self.tools = list(res.tools)
        return self.tools

    async def call(self, name: str, args: dict) -> Any:
        res = await self.session.call_tool(name, args)
        text = "\n".join(getattr(c, "text", "") for c in (res.content or []) if getattr(c, "type", "") == "text")
        if res.isError:
            raise ToolError(text or f"tool {name} failed")
        if text:
            try:
                return json.loads(text)
            except ValueError:
                pass
        if getattr(res, "structuredContent", None) is not None:
            return res.structuredContent
        return {"text": text}


@asynccontextmanager
async def connect() -> AsyncIterator[McpTools]:
    async with streamablehttp_client(config.MCP_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = McpTools(session)
            await tools.list_tools()
            yield tools
