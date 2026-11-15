import os

REMEDY_API_URL = os.getenv("REMEDY_API_URL", "http://localhost:5080").rstrip("/")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN", "change-me-service-token")
MCP_URL = os.getenv("MCP_URL", "http://localhost:8100/mcp")

# Any OpenAI-compatible chat API (default Groq). XAI_* names are still read for backward compatibility.
LLM_API_KEY = (os.getenv("LLM_API_KEY") or os.getenv("XAI_API_KEY") or "").strip()
LLM_MODEL = os.getenv("LLM_MODEL") or os.getenv("XAI_MODEL") or "openai/gpt-oss-20b"
LLM_BASE_URL = os.getenv("LLM_BASE_URL") or os.getenv("XAI_BASE_URL") or "https://api.groq.com/openai/v1"
# gpt-oss models think before answering; "low" = fewer tokens -> faster and fewer rate-limit waits
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "low").strip().lower()


def llm_extra() -> dict:
    """Extra request options for models that support them."""
    if "gpt-oss" in LLM_MODEL and LLM_REASONING_EFFORT in ("low", "medium", "high"):
        return {"reasoning_effort": LLM_REASONING_EFFORT}
    return {}


def llm_provider() -> str:
    url = LLM_BASE_URL.lower()
    if "groq.com" in url:
        return "Groq"
    if "x.ai" in url:
        return "xAI Grok"
    if "openai.com" in url:
        return "OpenAI"
    return "OpenAI-compatible"


_MODE = os.getenv("LLM_MODE", "auto").strip().lower()

MAX_TOOL_CALLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "12"))
TIMEOUT_SEC = int(os.getenv("AGENT_TIMEOUT_SEC", "90"))

SKILLS_DIR = os.getenv("SKILLS_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "skills"))


def llm_mode() -> str:
    """'llm' or 'mock'. auto = llm only when an API key is configured."""
    if _MODE == "mock":
        return "mock"
    return "llm" if LLM_API_KEY else "mock"
