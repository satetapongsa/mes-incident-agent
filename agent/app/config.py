import os

REMEDY_API_URL = os.getenv("REMEDY_API_URL", "http://localhost:5080").rstrip("/")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN", "change-me-service-token")
MCP_URL = os.getenv("MCP_URL", "http://localhost:8100/mcp")

XAI_API_KEY = os.getenv("XAI_API_KEY", "").strip()
XAI_MODEL = os.getenv("XAI_MODEL", "grok-4")
XAI_BASE_URL = os.getenv("XAI_BASE_URL", "https://api.x.ai/v1")
_MODE = os.getenv("LLM_MODE", "auto").strip().lower()

MAX_TOOL_CALLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "12"))
TIMEOUT_SEC = int(os.getenv("AGENT_TIMEOUT_SEC", "90"))

SKILLS_DIR = os.getenv("SKILLS_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "skills"))


def llm_mode() -> str:
    """'llm' (Grok) or 'mock'. auto = llm only when an API key is configured."""
    if _MODE == "mock":
        return "mock"
    if _MODE == "llm":
        return "llm" if XAI_API_KEY else "mock"
    return "llm" if XAI_API_KEY else "mock"
